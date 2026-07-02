import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bot,
  BookOpenText,
  CheckCircle2,
  ExternalLink,
  Headphones,
  MessageSquareText,
  Paperclip,
  RefreshCcw,
  Send,
  Settings,
  Store,
  Tags,
  UserRoundCheck,
  Users,
  Workflow,
} from 'lucide-react';
import {
  assignChatwootConversation,
  createChatwootCannedResponse,
  createChatwootCampaign,
  createChatwootContactNote,
  createChatwootInternalNote,
  createChatwootMacro,
  createChatwootWebhook,
  deleteChatwootConversationMessage,
  executeChatwootMacro,
  fetchChatwootCampaigns,
  fetchChatwootConversationMessages,
  fetchChatwootConversations,
  fetchChatwootAssignableAgents,
  fetchChatwootAutomationRules,
  fetchChatwootCannedResponses,
  fetchChatwootContacts,
  fetchChatwootContactConversations,
  fetchChatwootContactNotes,
  fetchChatwootInboxes,
  fetchChatwootLabels,
  fetchChatwootMacros,
  fetchChatwootReportsSummary,
  fetchChatwootTeams,
  fetchChatwootWebhooks,
  retryChatwootConversationMessage,
  sendChatwootConversationAttachment,
  sendChatwootConversationMessage,
  translateChatwootConversationMessage,
  updateChatwootContact,
  updateChatwootConversationLabels,
  updateChatwootConversationStatus,
  updateChatwootInbox,
  updateChatwootWebhook,
  type ChatwootAgentSummary,
  type ChatwootAutomationRuleSummary,
  type ChatwootCannedResponseSummary,
  type ChatwootCampaignSummary,
  type ChatwootConnectionPayload,
  type ChatwootContactNoteSummary,
  type ChatwootContactSummary,
  type ChatwootConversationSummary,
  type ChatwootInboxSummary,
  type ChatwootLabelSummary,
  type ChatwootMessageSummary,
  type ChatwootMacroSummary,
  type ChatwootReportSummary,
  type ChatwootTeamSummary,
  type ChatwootWebhookSummary,
} from '../../../services/internalApi';

type StoreBinding = {
  id: string;
  platform: '小红书' | '抖店' | '淘宝天猫' | '拼多多';
  name: string;
  status: 'connected' | 'pending';
  mode: 'ai-first' | 'human-first';
  accountId: string;
  inboxId: string;
  baseUrl: string;
  apiToken: string;
  shopHint: string;
  owner: string;
};

type WorkspaceTab = 'workbench' | 'conversations' | 'customers' | 'canned' | 'automation' | 'agents' | 'reports' | 'settings' | 'parity';

type Conversation = {
  id: string;
  customer: string;
  platform: StoreBinding['platform'];
  storeName: string;
  status: 'ai' | 'human';
  lastMessage: string;
  orderHint: string;
  risk: 'low' | 'medium' | 'high';
  updatedAt: number;
};

const readEnv = (key: string) => {
  const value = import.meta.env?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

const buildStoreBindings = (): StoreBinding[] => [
  {
    id: 'xhs-local',
    platform: '小红书',
    name: '梅奥测试客服',
    status: readEnv('VITE_CHATWOOT_INBOX_ID') && readEnv('VITE_CHATWOOT_API_TOKEN') ? 'connected' : 'pending',
    mode: 'ai-first',
    baseUrl: readEnv('VITE_CHATWOOT_BASE_URL'),
    accountId: readEnv('VITE_CHATWOOT_ACCOUNT_ID') || '1',
    inboxId: readEnv('VITE_CHATWOOT_INBOX_ID'),
    apiToken: readEnv('VITE_CHATWOOT_API_TOKEN'),
    shopHint: '本地 Chatwoot Inbox',
    owner: '客服组',
  },
  {
    id: 'douyin-next',
    platform: '抖店',
    name: '抖店店铺待绑定',
    status: 'pending',
    mode: 'human-first',
    baseUrl: '',
    accountId: '',
    inboxId: '',
    apiToken: '',
    shopHint: '等待飞鸽/ISV 通道',
    owner: '待分配',
  },
  {
    id: 'tmall-next',
    platform: '淘宝天猫',
    name: '淘宝天猫待绑定',
    status: 'pending',
    mode: 'human-first',
    baseUrl: '',
    accountId: '',
    inboxId: '',
    apiToken: '',
    shopHint: '等待千牛/TOP 授权',
    owner: '待分配',
  },
  {
    id: 'pdd-next',
    platform: '拼多多',
    name: '拼多多待绑定',
    status: 'pending',
    mode: 'human-first',
    baseUrl: '',
    accountId: '',
    inboxId: '',
    apiToken: '',
    shopHint: '等待平台客服接口',
    owner: '待分配',
  },
];

const workspaceTabs: Array<{ id: WorkspaceTab; label: string; icon: React.ElementType }> = [
  { id: 'workbench', label: '客服工作台', icon: MessageSquareText },
  { id: 'conversations', label: '会话管理', icon: Tags },
  { id: 'customers', label: '客户资料', icon: Users },
  { id: 'canned', label: '话术库', icon: BookOpenText },
  { id: 'automation', label: '自动化', icon: Workflow },
  { id: 'agents', label: '坐席', icon: Headphones },
  { id: 'reports', label: '报表', icon: BarChart3 },
  { id: 'settings', label: '店铺设置', icon: Settings },
  { id: 'parity', label: '功能对照', icon: CheckCircle2 },
];

const parityItems = [
  ['Inbox / 渠道 / 店铺接入', '部分接入', '当前支持本地 Chatwoot Inbox 作为小红书测试店铺，平台官方授权待接。'],
  ['Conversation 会话列表', '已接入', '已接会话拉取、消息同步和 open / pending / resolved 状态切换。'],
  ['Messages 消息与回复', '已接入', '已接文本消息历史、客服回复、附件发送和私密内部备注；商品卡片待接平台连接器。'],
  ['Internal Notes 内部备注', '已接入', '已通过 Chatwoot private message 写入，仅客服侧可见。'],
  ['Assignment 坐席/团队分配', '已接入', '已接 assignable agents、teams 和 conversation assignments。'],
  ['Labels 标签', '已接入', '已接账号标签拉取和会话标签写入。'],
  ['Canned Responses 话术库', '已接入', '已接 Chatwoot canned responses 列表与创建。'],
  ['Contacts 客户资料', '已接入', '已接 Chatwoot Contacts 基础资料；订单、平台用户画像待接外部系统。'],
  ['Automations / Macros 自动化', '已接入', '已接 Chatwoot automation rules 读取、宏列表、创建和执行。'],
  ['Reports 报表', '已接入', '已接 Chatwoot v2 reports summary 作为店铺 7 天摘要。'],
  ['Webhooks / Integrations', '部分接入', '已接 Chatwoot webhooks 和 campaigns；国内平台消息、订单、商品库仍需要独立连接器凭证。'],
  ['AI Agent / Bot', '部分接入', '当前只有建议回复占位，自动回复策略和工具调用待接。'],
];

const platformTone: Record<StoreBinding['platform'], { color: string; background: string }> = {
  小红书: { color: '#dc2626', background: 'rgba(220,38,38,0.10)' },
  抖店: { color: '#111827', background: 'rgba(17,24,39,0.09)' },
  淘宝天猫: { color: '#ea580c', background: 'rgba(234,88,12,0.11)' },
  拼多多: { color: '#b91c1c', background: 'rgba(185,28,28,0.10)' },
};

const statusTone: Record<string, { color: string; background: string }> = {
  已接入: { color: '#059669', background: 'rgba(5,150,105,0.10)' },
  部分接入: { color: '#d97706', background: 'rgba(217,119,6,0.12)' },
  待接入: { color: '#64748b', background: 'rgba(100,116,139,0.12)' },
};

const riskTone: Record<Conversation['risk'], { label: string; color: string; background: string }> = {
  low: { label: '低风险', color: '#059669', background: 'rgba(5,150,105,0.10)' },
  medium: { label: '需确认', color: '#d97706', background: 'rgba(217,119,6,0.12)' },
  high: { label: '转人工', color: '#dc2626', background: 'rgba(220,38,38,0.11)' },
};

const toConnectionPayload = (store: StoreBinding): ChatwootConnectionPayload => ({
  baseUrl: store.baseUrl,
  accountId: store.accountId,
  inboxId: store.inboxId,
  apiToken: store.apiToken,
});

const toDisplayConversation = (item: ChatwootConversationSummary, store: StoreBinding): Conversation => ({
  id: item.id,
  customer: item.customerName || `${store.platform}客户 ${item.id}`,
  platform: store.platform,
  storeName: store.name,
  status: item.status === 'resolved' ? 'human' : 'ai',
  lastMessage: item.lastMessage || '暂无最近消息',
  orderHint: item.customerPhone ? `手机号 ${item.customerPhone}` : '未绑定订单',
  risk: item.status === 'open' ? 'medium' : 'low',
  updatedAt: item.updatedAt,
});

const buildChatwootConsoleUrl = (store: StoreBinding) => {
  const normalizedBase = store.baseUrl.trim().replace(/\/+$/, '');
  if (!normalizedBase || !store.accountId) return '';
  const suffix = store.inboxId
    ? `/app/accounts/${encodeURIComponent(store.accountId)}/inboxes/${encodeURIComponent(store.inboxId)}`
    : `/app/accounts/${encodeURIComponent(store.accountId)}`;
  return `${normalizedBase}${suffix}`;
};

const formatTime = (value: number) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};

const formatDateTime = (value: number) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};

const getReportValue = (summary: ChatwootReportSummary, key: string) => {
  const value = summary[key];
  if (value && typeof value === 'object' && 'value' in value) return String((value as { value?: unknown }).value ?? '-');
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const AiCustomerServiceModule: React.FC = () => {
  const [stores] = useState<StoreBinding[]>(() => buildStoreBindings());
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('workbench');
  const [conversationsByStore, setConversationsByStore] = useState<Record<string, ChatwootConversationSummary[]>>({});
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatwootMessageSummary[]>>({});
  const [conversationLabelsById, setConversationLabelsById] = useState<Record<string, string[]>>({});
  const [labels, setLabels] = useState<ChatwootLabelSummary[]>([]);
  const [agents, setAgents] = useState<ChatwootAgentSummary[]>([]);
  const [teams, setTeams] = useState<ChatwootTeamSummary[]>([]);
  const [cannedResponses, setCannedResponses] = useState<ChatwootCannedResponseSummary[]>([]);
  const [automationRules, setAutomationRules] = useState<ChatwootAutomationRuleSummary[]>([]);
  const [contacts, setContacts] = useState<ChatwootContactSummary[]>([]);
  const [contactNotesById, setContactNotesById] = useState<Record<string, ChatwootContactNoteSummary[]>>({});
  const [contactConversationsById, setContactConversationsById] = useState<Record<string, ChatwootConversationSummary[]>>({});
  const [macros, setMacros] = useState<ChatwootMacroSummary[]>([]);
  const [campaigns, setCampaigns] = useState<ChatwootCampaignSummary[]>([]);
  const [webhooks, setWebhooks] = useState<ChatwootWebhookSummary[]>([]);
  const [inboxes, setInboxes] = useState<ChatwootInboxSummary[]>([]);
  const [reportSummary, setReportSummary] = useState<ChatwootReportSummary>({});
  const [activeConversationId, setActiveConversationId] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedWebhookId, setSelectedWebhookId] = useState('');
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [cannedShortCode, setCannedShortCode] = useState('');
  const [cannedContent, setCannedContent] = useState('');
  const [contactNoteDraft, setContactNoteDraft] = useState('');
  const [contactCustomJson, setContactCustomJson] = useState('{}');
  const [macroName, setMacroName] = useState('');
  const [macroMessage, setMacroMessage] = useState('');
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSubscriptions, setWebhookSubscriptions] = useState('message_created,conversation_created');
  const [inboxName, setInboxName] = useState('');
  const [inboxAutoAssignment, setInboxAutoAssignment] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loadingAction, setLoadingAction] = useState<'stores' | 'messages' | 'send' | 'attachment' | 'resources' | 'status' | 'note' | 'labels' | 'assign' | 'canned' | 'contact' | 'messageAction' | 'macro' | 'storeSettings' | ''>('');

  const selectedStore = selectedStoreId ? stores.find((item) => item.id === selectedStoreId) || null : null;
  const connectionPayload = useMemo(() => selectedStore ? toConnectionPayload(selectedStore) : null, [selectedStore]);
  const canUseSelectedStore = Boolean(selectedStore && selectedStore.status === 'connected' && selectedStore.baseUrl && selectedStore.inboxId && selectedStore.apiToken);
  const displayConversations = useMemo(
    () => selectedStore ? (conversationsByStore[selectedStore.id] || []).map((item) => toDisplayConversation(item, selectedStore)) : [],
    [selectedStore, conversationsByStore],
  );
  const activeConversation = displayConversations.find((item) => item.id === activeConversationId) || displayConversations[0] || null;
  const activeMessages = activeConversation ? messagesByConversation[activeConversation.id] || [] : [];
  const activeConversationLabels = activeConversation ? conversationLabelsById[activeConversation.id] || [] : [];
  const selectedContact = contacts.find((item) => item.id === selectedContactId) || contacts[0] || null;
  const selectedContactNotes = selectedContact ? contactNotesById[selectedContact.id] || [] : [];
  const selectedContactConversations = selectedContact ? contactConversationsById[selectedContact.id] || [] : [];
  const selectedInbox = selectedStore ? inboxes.find((item) => item.id === selectedStore.inboxId) || inboxes[0] || null : null;
  const selectedWebhook = webhooks.find((item) => item.id === selectedWebhookId) || null;
  const consoleUrl = useMemo(() => selectedStore ? buildChatwootConsoleUrl(selectedStore) : '', [selectedStore]);
  const aiWebhookUrls = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        direct: '',
        docker: 'http://host.docker.internal:3100/api/chatwoot/ai-webhook',
        colima: 'http://host.lima.internal:3100/api/chatwoot/ai-webhook',
      };
    }
    const protocol = window.location.protocol || 'http:';
    const host = window.location.hostname || '127.0.0.1';
    return {
      direct: `${protocol}//${host}:3100/api/chatwoot/ai-webhook`,
      docker: 'http://host.docker.internal:3100/api/chatwoot/ai-webhook',
      colima: 'http://host.lima.internal:3100/api/chatwoot/ai-webhook',
    };
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId || !canUseSelectedStore || !connectionPayload) return;
    setLoadingAction('messages');
    setErrorMessage('');
    try {
      const result = await fetchChatwootConversationMessages({ ...connectionPayload, conversationId });
      setMessagesByConversation((prev) => ({ ...prev, [conversationId]: result.messages || [] }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '会话消息拉取失败');
    } finally {
      setLoadingAction('');
    }
  }, [canUseSelectedStore, connectionPayload]);

  const loadStoreResources = useCallback(async () => {
    if (!canUseSelectedStore || !connectionPayload) return;
    setLoadingAction('resources');
    setErrorMessage('');
    try {
      const until = Math.floor(Date.now() / 1000);
      const since = until - 7 * 24 * 60 * 60;
      const [labelResult, agentResult, teamResult, cannedResult, automationResult, contactResult, macroResult, campaignResult, webhookResult, inboxResult, reportResult] = await Promise.all([
        fetchChatwootLabels(connectionPayload),
        fetchChatwootAssignableAgents(connectionPayload),
        fetchChatwootTeams(connectionPayload),
        fetchChatwootCannedResponses(connectionPayload),
        fetchChatwootAutomationRules(connectionPayload),
        fetchChatwootContacts(connectionPayload),
        fetchChatwootMacros(connectionPayload),
        fetchChatwootCampaigns(connectionPayload),
        fetchChatwootWebhooks(connectionPayload),
        fetchChatwootInboxes(connectionPayload),
        fetchChatwootReportsSummary({ ...connectionPayload, since, until }),
      ]);
      setLabels(labelResult.labels || []);
      setAgents(agentResult.agents || []);
      setTeams(teamResult.teams || []);
      setCannedResponses(cannedResult.cannedResponses || []);
      setAutomationRules(automationResult.automationRules || []);
      setContacts(contactResult.contacts || []);
      setSelectedContactId((current) => current || contactResult.contacts?.[0]?.id || '');
      setMacros(macroResult.macros || []);
      setCampaigns(campaignResult.campaigns || []);
      setWebhooks(webhookResult.webhooks || []);
      setInboxes(inboxResult.inboxes || []);
      setSelectedWebhookId((current) => current || webhookResult.webhooks?.[0]?.id || '');
      setReportSummary(reportResult.summary || {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chatwoot 店铺资源拉取失败');
    } finally {
      setLoadingAction('');
    }
  }, [canUseSelectedStore, connectionPayload]);

  const loadConversations = useCallback(async () => {
    if (!selectedStore || !canUseSelectedStore || !connectionPayload) return;
    setLoadingAction('stores');
    setStatusMessage('');
    setErrorMessage('');
    try {
      const result = await fetchChatwootConversations(connectionPayload);
      const nextConversations = result.conversations || [];
      setConversationsByStore((prev) => ({ ...prev, [selectedStore.id]: nextConversations }));
      const firstConversationId = nextConversations[0]?.id || '';
      setActiveConversationId(firstConversationId);
      setHandoffEnabled(nextConversations[0]?.status === 'resolved');
      setStatusMessage(`已拉取 ${nextConversations.length} 条会话`);
      if (firstConversationId) await loadMessages(firstConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chatwoot 会话拉取失败');
    } finally {
      setLoadingAction('');
    }
  }, [selectedStore, canUseSelectedStore, connectionPayload, loadMessages]);

  useEffect(() => {
    if (selectedStore) {
      loadConversations();
      loadStoreResources();
    }
  }, [selectedStore, loadConversations, loadStoreResources]);

  const enterStore = (store: StoreBinding) => {
    if (store.status !== 'connected') return;
    setSelectedStoreId(store.id);
    setActiveTab('workbench');
    setActiveConversationId('');
    setReplyDraft('');
    setAttachmentFile(null);
    setNoteDraft('');
    setLabelDraft('');
    setSelectedAssigneeId('');
    setSelectedTeamId('');
    setStatusMessage('');
    setErrorMessage('');
  };

  const backToStores = () => {
    setSelectedStoreId(null);
    setActiveConversationId('');
    setReplyDraft('');
    setAttachmentFile(null);
    setNoteDraft('');
    setLabelDraft('');
    setSelectedAssigneeId('');
    setSelectedTeamId('');
    setStatusMessage('');
    setErrorMessage('');
  };

  const selectConversation = async (conversation: Conversation) => {
    setActiveConversationId(conversation.id);
    setHandoffEnabled(conversation.status === 'human');
    if (!messagesByConversation[conversation.id]) await loadMessages(conversation.id);
  };

  const sendReply = async () => {
    if (!activeConversation || !replyDraft.trim() || !connectionPayload) return;
    setLoadingAction('send');
    setErrorMessage('');
    try {
      const result = await sendChatwootConversationMessage({
        ...connectionPayload,
        conversationId: activeConversation.id,
        content: replyDraft.trim(),
      });
      setMessagesByConversation((prev) => ({
        ...prev,
        [activeConversation.id]: [...(prev[activeConversation.id] || []), result.message],
      }));
      setReplyDraft('');
      setStatusMessage('回复已发送到 Chatwoot');
      await loadConversations();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '回复发送失败');
    } finally {
      setLoadingAction('');
    }
  };

  const sendAttachment = async () => {
    if (!activeConversation || !attachmentFile || !connectionPayload) return;
    setLoadingAction('attachment');
    setErrorMessage('');
    try {
      const result = await sendChatwootConversationAttachment({
        ...connectionPayload,
        conversationId: activeConversation.id,
        content: replyDraft.trim(),
        file: attachmentFile,
        fileName: attachmentFile.name,
      });
      setMessagesByConversation((prev) => ({
        ...prev,
        [activeConversation.id]: [...(prev[activeConversation.id] || []), result.message],
      }));
      setReplyDraft('');
      setAttachmentFile(null);
      setStatusMessage('附件已发送到 Chatwoot');
      await loadConversations();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '附件发送失败');
    } finally {
      setLoadingAction('');
    }
  };

  const changeConversationStatus = async (status: 'open' | 'pending' | 'resolved') => {
    if (!activeConversation || !connectionPayload || !selectedStore) return;
    setLoadingAction('status');
    setErrorMessage('');
    try {
      const result = await updateChatwootConversationStatus({
        ...connectionPayload,
        conversationId: activeConversation.id,
        status,
      });
      setConversationsByStore((prev) => ({
        ...prev,
        [selectedStore.id]: (prev[selectedStore.id] || []).map((item) => (
          item.id === activeConversation.id ? { ...item, status: result.conversation.status || status } : item
        )),
      }));
      setHandoffEnabled(status === 'resolved');
      setStatusMessage(`会话状态已更新为 ${status}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '会话状态更新失败');
    } finally {
      setLoadingAction('');
    }
  };

  const createInternalNote = async () => {
    if (!activeConversation || !noteDraft.trim() || !connectionPayload) return;
    setLoadingAction('note');
    setErrorMessage('');
    try {
      const result = await createChatwootInternalNote({
        ...connectionPayload,
        conversationId: activeConversation.id,
        content: noteDraft.trim(),
      });
      setMessagesByConversation((prev) => ({
        ...prev,
        [activeConversation.id]: [...(prev[activeConversation.id] || []), result.message],
      }));
      setNoteDraft('');
      setStatusMessage('内部备注已写入 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '内部备注发送失败');
    } finally {
      setLoadingAction('');
    }
  };

  const applyConversationLabels = async () => {
    if (!activeConversation || !connectionPayload) return;
    const nextLabels = labelDraft
      .split(/[,\s，、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (nextLabels.length === 0) return;
    setLoadingAction('labels');
    setErrorMessage('');
    try {
      const result = await updateChatwootConversationLabels({
        ...connectionPayload,
        conversationId: activeConversation.id,
        labels: nextLabels,
      });
      setConversationLabelsById((prev) => ({ ...prev, [activeConversation.id]: result.labels || nextLabels }));
      setStatusMessage('会话标签已同步到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '会话标签更新失败');
    } finally {
      setLoadingAction('');
    }
  };

  const assignConversation = async () => {
    if (!activeConversation || !connectionPayload || (!selectedAssigneeId && !selectedTeamId)) return;
    setLoadingAction('assign');
    setErrorMessage('');
    try {
      const result = await assignChatwootConversation({
        ...connectionPayload,
        conversationId: activeConversation.id,
        assigneeId: selectedAssigneeId || undefined,
        teamId: selectedAssigneeId ? undefined : selectedTeamId,
      });
      setStatusMessage(result.assignment?.name ? `会话已分配给 ${result.assignment.name}` : '会话分配已同步到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '会话分配失败');
    } finally {
      setLoadingAction('');
    }
  };

  const createCannedResponse = async () => {
    if (!connectionPayload || !cannedShortCode.trim() || !cannedContent.trim()) return;
    setLoadingAction('canned');
    setErrorMessage('');
    try {
      const result = await createChatwootCannedResponse({
        ...connectionPayload,
        shortCode: cannedShortCode.trim(),
        content: cannedContent.trim(),
      });
      setCannedResponses((prev) => [result.cannedResponse, ...prev.filter((item) => item.id !== result.cannedResponse.id)]);
      setCannedShortCode('');
      setCannedContent('');
      setStatusMessage('话术已创建到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '话术创建失败');
    } finally {
      setLoadingAction('');
    }
  };

  const loadContactDetail = async (contactId: string) => {
    if (!connectionPayload || !contactId) return;
    setLoadingAction('contact');
    setErrorMessage('');
    try {
      const [notesResult, conversationsResult] = await Promise.all([
        fetchChatwootContactNotes({ ...connectionPayload, contactId }),
        fetchChatwootContactConversations({ ...connectionPayload, contactId }),
      ]);
      setContactNotesById((prev) => ({ ...prev, [contactId]: notesResult.notes || [] }));
      setContactConversationsById((prev) => ({ ...prev, [contactId]: conversationsResult.conversations || [] }));
      const contact = contacts.find((item) => item.id === contactId);
      setContactCustomJson(JSON.stringify(contact?.customAttributes || {}, null, 2));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '客户资料扩展信息拉取失败');
    } finally {
      setLoadingAction('');
    }
  };

  const createContactNote = async () => {
    if (!connectionPayload || !selectedContact || !contactNoteDraft.trim()) return;
    setLoadingAction('contact');
    setErrorMessage('');
    try {
      const result = await createChatwootContactNote({
        ...connectionPayload,
        contactId: selectedContact.id,
        content: contactNoteDraft.trim(),
      });
      setContactNotesById((prev) => ({ ...prev, [selectedContact.id]: [result.note, ...(prev[selectedContact.id] || [])] }));
      setContactNoteDraft('');
      setStatusMessage('客户备注已写入 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '客户备注创建失败');
    } finally {
      setLoadingAction('');
    }
  };

  const saveContactAttributes = async () => {
    if (!connectionPayload || !selectedContact) return;
    setLoadingAction('contact');
    setErrorMessage('');
    try {
      const customAttributes = JSON.parse(contactCustomJson || '{}') as Record<string, unknown>;
      const result = await updateChatwootContact({
        ...connectionPayload,
        contactId: selectedContact.id,
        name: selectedContact.name,
        email: selectedContact.email,
        phone: selectedContact.phone,
        customAttributes,
      });
      setContacts((prev) => prev.map((item) => item.id === selectedContact.id ? result.contact : item));
      setStatusMessage('客户自定义属性已同步到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '客户属性保存失败，请检查 JSON 格式');
    } finally {
      setLoadingAction('');
    }
  };

  const runMessageAction = async (message: ChatwootMessageSummary, action: 'delete' | 'retry' | 'translate') => {
    if (!connectionPayload || !activeConversation) return;
    setLoadingAction('messageAction');
    setErrorMessage('');
    try {
      if (action === 'delete') {
        await deleteChatwootConversationMessage({ ...connectionPayload, conversationId: activeConversation.id, messageId: message.id });
        setMessagesByConversation((prev) => ({
          ...prev,
          [activeConversation.id]: (prev[activeConversation.id] || []).filter((item) => item.id !== message.id),
        }));
        setStatusMessage('消息已从 Chatwoot 删除');
      } else if (action === 'retry') {
        await retryChatwootConversationMessage({ ...connectionPayload, conversationId: activeConversation.id, messageId: message.id });
        setStatusMessage('消息已提交 Chatwoot 重试');
      } else {
        const result = await translateChatwootConversationMessage({ ...connectionPayload, conversationId: activeConversation.id, messageId: message.id, targetLanguage: 'zh_CN' });
        setMessagesByConversation((prev) => ({
          ...prev,
          [activeConversation.id]: (prev[activeConversation.id] || []).map((item) => (
            item.id === message.id ? { ...item, content: result.translation.content || item.content } : item
          )),
        }));
        setStatusMessage('消息翻译已返回');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '消息操作失败');
    } finally {
      setLoadingAction('');
    }
  };

  const createMacro = async () => {
    if (!connectionPayload || !macroName.trim() || !macroMessage.trim()) return;
    setLoadingAction('macro');
    setErrorMessage('');
    try {
      const result = await createChatwootMacro({
        ...connectionPayload,
        name: macroName.trim(),
        visibility: 'global',
        actions: [{ actionName: 'send_message', actionParams: [macroMessage.trim()] }],
      });
      setMacros((prev) => [result.macro, ...prev.filter((item) => item.id !== result.macro.id)]);
      setMacroName('');
      setMacroMessage('');
      setStatusMessage('宏已创建到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '宏创建失败');
    } finally {
      setLoadingAction('');
    }
  };

  const runMacro = async (macroId: string) => {
    if (!connectionPayload || !activeConversation || !macroId) return;
    setLoadingAction('macro');
    setErrorMessage('');
    try {
      await executeChatwootMacro({ ...connectionPayload, macroId, conversationIds: [activeConversation.id] });
      setStatusMessage('宏已提交 Chatwoot 执行');
      await loadMessages(activeConversation.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '宏执行失败');
    } finally {
      setLoadingAction('');
    }
  };

  const createCampaign = async () => {
    if (!connectionPayload || !campaignTitle.trim() || !campaignMessage.trim()) return;
    setLoadingAction('storeSettings');
    setErrorMessage('');
    try {
      const result = await createChatwootCampaign({
        ...connectionPayload,
        title: campaignTitle.trim(),
        message: campaignMessage.trim(),
        inboxId: selectedStore?.inboxId || connectionPayload.inboxId,
        enabled: true,
      });
      setCampaigns((prev) => [result.campaign, ...prev.filter((item) => item.id !== result.campaign.id)]);
      setCampaignTitle('');
      setCampaignMessage('');
      setStatusMessage('活动已创建到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '活动创建失败');
    } finally {
      setLoadingAction('');
    }
  };

  const saveWebhook = async () => {
    if (!connectionPayload || !webhookName.trim() || !webhookUrl.trim()) return;
    const subscriptions = webhookSubscriptions
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    setLoadingAction('storeSettings');
    setErrorMessage('');
    try {
      const result = selectedWebhookId
        ? await updateChatwootWebhook({ ...connectionPayload, webhookId: selectedWebhookId, name: webhookName.trim(), url: webhookUrl.trim(), subscriptions })
        : await createChatwootWebhook({ ...connectionPayload, name: webhookName.trim(), url: webhookUrl.trim(), subscriptions });
      setWebhooks((prev) => [result.webhook, ...prev.filter((item) => item.id !== result.webhook.id)]);
      setSelectedWebhookId(result.webhook.id);
      setStatusMessage(selectedWebhookId ? 'Webhook 已更新到 Chatwoot' : 'Webhook 已创建到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Webhook 保存失败');
    } finally {
      setLoadingAction('');
    }
  };

  const saveInboxSettings = async () => {
    if (!connectionPayload || !selectedInbox) return;
    setLoadingAction('storeSettings');
    setErrorMessage('');
    try {
      const result = await updateChatwootInbox({
        ...connectionPayload,
        targetInboxId: selectedInbox.id,
        name: inboxName.trim() || selectedInbox.name,
        enableAutoAssignment: inboxAutoAssignment,
      });
      setInboxes((prev) => prev.map((item) => (item.id === result.inbox.id ? result.inbox : item)));
      setStatusMessage('收件箱设置已更新到 Chatwoot');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '收件箱设置保存失败');
    } finally {
      setLoadingAction('');
    }
  };

  useEffect(() => {
    if (selectedContactId && connectionPayload) loadContactDetail(selectedContactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContactId, connectionPayload]);

  useEffect(() => {
    setInboxName(selectedInbox?.name || selectedStore?.name || '');
    setInboxAutoAssignment(Boolean(selectedInbox?.enableAutoAssignment));
  }, [selectedInbox, selectedStore]);

  useEffect(() => {
    setWebhookName(selectedWebhook?.name || '');
    setWebhookUrl(selectedWebhook?.url || '');
    setWebhookSubscriptions((selectedWebhook?.subscriptions || ['message_created', 'conversation_created']).join(','));
  }, [selectedWebhook]);

  const fillAiSuggestion = () => {
    if (!activeConversation) return;
    setReplyDraft(`您好，${activeConversation.lastMessage.includes('发货') ? '今天下单后我们会尽快安排发货，具体时效以店铺订单页为准。' : '这个问题我帮您确认一下商品信息和售后规则。'}`);
  };

  const openConsole = () => {
    if (!consoleUrl) return;
    window.open(consoleUrl, '_blank', 'noopener,noreferrer');
  };

  const renderStoreAccess = () => (
    <div className="flex h-full min-h-0 flex-col px-5 py-4">
      <div className="mb-4 border-b pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <h1 className="text-[28px] font-semibold tracking-[0]" style={{ color: 'var(--text-primary)' }}>AI客服</h1>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          店铺接入先行。选择已经绑定的店铺后，进入该店铺自己的客服工作台、策略和报表。
        </p>
      </div>

      <section className="mb-4">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Store size={17} strokeWidth={1.8} />
          店铺接入 / 绑定店铺
        </div>
        <div className="grid grid-cols-4 gap-3">
          {stores.map((store) => {
            const tone = platformTone[store.platform];
            const connected = store.status === 'connected';
            return (
              <article
                key={store.id}
                className="rounded-[8px] border p-4"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: tone.color, background: tone.background }}>
                    {store.platform}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: connected ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                    {connected ? '已绑定' : '待接入'}
                  </span>
                </div>
                <h2 className="truncate text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{store.name}</h2>
                <p className="mt-2 min-h-[36px] text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{store.shopHint}</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  <span className="rounded-[6px] px-2 py-1" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    负责人 {store.owner}
                  </span>
                  <span className="rounded-[6px] px-2 py-1" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    {store.mode === 'ai-first' ? 'AI优先' : '人工优先'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => enterStore(store)}
                  disabled={!connected}
                  className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ background: connected ? 'var(--accent)' : 'var(--bg-elevated)', color: connected ? '#fff' : 'var(--text-tertiary)' }}
                >
                  {connected ? '进入客服台' : '绑定店铺'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>落地目标</div>
        <div className="grid grid-cols-4 gap-3 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
          <p>1. 外层只处理平台和店铺接入，不混入日常聊天。</p>
          <p>2. 每个店铺独立承接会话、客户、话术、自动化和报表。</p>
          <p>3. Chatwoot 作为会话内核，梅奥前端按国内电商客服重组。</p>
          <p>4. 未接功能在功能对照里明确暴露，不假装完成。</p>
        </div>
      </section>
    </div>
  );

  const renderWorkbench = () => (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_280px] gap-4">
      <aside className="flex min-h-0 flex-col rounded-[8px] border p-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            <MessageSquareText size={16} strokeWidth={1.8} />
            会话
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{displayConversations.length} 条</span>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1 text-[11px]">
          {['全部', '未回复', '人工'].map((label) => (
            <span key={label} className="rounded-[6px] px-2 py-1 text-center font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {label}
            </span>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {displayConversations.map((conversation) => {
            const selected = conversation.id === activeConversation?.id;
            const tone = riskTone[conversation.risk];
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => selectConversation(conversation)}
                className="w-full rounded-[8px] border px-3 py-3 text-left transition"
                style={{
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  borderColor: selected ? 'color-mix(in srgb, var(--accent) 42%, transparent)' : 'var(--border-subtle)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{conversation.customer}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: tone.background, color: tone.color }}>
                    {tone.label}
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{conversation.lastMessage}</p>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{conversation.orderHint}</p>
              </button>
            );
          })}
          {displayConversations.length === 0 && (
            <div className="rounded-[8px] border px-3 py-5 text-center text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
              暂无会话
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-[8px] border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold tracking-[0]" style={{ color: 'var(--text-primary)' }}>
              {activeConversation?.customer || '选择一个会话'}
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              {activeConversation ? `${activeConversation.storeName} · ${activeConversation.orderHint}` : selectedStore?.name}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(['open', 'pending', 'resolved'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => changeConversationStatus(status)}
                disabled={!activeConversation || loadingAction === 'status'}
                className="h-8 rounded-[8px] px-2.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: activeConversation?.status === (status === 'resolved' ? 'human' : 'ai') ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                  color: status === 'resolved' ? '#dc2626' : 'var(--text-secondary)',
                }}
              >
                {status === 'open' ? '打开' : status === 'pending' ? '待处理' : '已解决'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHandoffEnabled((prev) => !prev)}
              disabled={!activeConversation}
              className="inline-flex h-8 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: handoffEnabled ? 'rgba(220,38,38,0.10)' : 'var(--accent-soft)', color: handoffEnabled ? '#dc2626' : 'var(--accent)' }}
            >
              <UserRoundCheck size={15} strokeWidth={1.8} />
              {handoffEnabled ? '人工接管中' : 'AI托管中'}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {loadingAction === 'messages' && (
            <div className="text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>消息加载中</div>
          )}
          {activeMessages.map((message) => {
            const isAgent = message.role === 'agent';
            return (
              <div key={message.id} className={isAgent ? 'ml-auto max-w-[78%]' : 'max-w-[78%]'}>
                <div className="mb-1 text-[11px]" style={{ color: 'var(--text-tertiary)', textAlign: isAgent ? 'right' : 'left' }}>
                  {message.senderName || (isAgent ? '客服' : message.role === 'system' ? '系统' : '客户')} {formatTime(message.createdAt)}
                </div>
                <div
                  className="rounded-[8px] border px-4 py-3 text-[13px] leading-6"
                  style={{
                    background: isAgent ? 'var(--accent-soft)' : message.role === 'system' ? 'var(--bg-elevated)' : 'var(--bg-input)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {message.content || (message.attachments?.length ? '附件' : '')}
                  {message.attachments?.length ? (
                    <div className="mt-2 space-y-1">
                      {message.attachments.map((attachment) => (
                        <a
                          key={attachment.id || attachment.url}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-[12px] font-semibold"
                          style={{ color: 'var(--accent)' }}
                        >
                          {attachment.fileType || '附件'} · 打开文件
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[
                      ['translate', '翻译'],
                      ['retry', '重试'],
                      ['delete', '删除'],
                    ].map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => runMessageAction(message, action as 'delete' | 'retry' | 'translate')}
                        disabled={loadingAction === 'messageAction'}
                        className="h-6 rounded-[6px] px-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                        style={{ background: 'var(--bg-elevated)', color: action === 'delete' ? '#dc2626' : 'var(--text-secondary)' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fillAiSuggestion}
              disabled={!activeConversation}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Bot size={14} strokeWidth={1.8} />
              AI建议回复
            </button>
            <button
              type="button"
              onClick={() => setHandoffEnabled(true)}
              disabled={!activeConversation}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'rgba(220,38,38,0.09)', color: '#dc2626' }}
            >
              <Headphones size={14} strokeWidth={1.8} />
              人工接管
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-[8px] border px-3 py-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
            <label
              className="inline-flex h-8 max-w-[150px] cursor-pointer items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-semibold"
              style={{ background: attachmentFile ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: attachmentFile ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <Paperclip size={14} strokeWidth={1.8} />
              <span className="min-w-0 truncate">{attachmentFile ? attachmentFile.name : '附件'}</span>
              <input
                type="file"
                className="hidden"
                disabled={!activeConversation || loadingAction === 'attachment'}
                onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
              />
            </label>
            <input
              value={replyDraft}
              onChange={(event) => setReplyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendReply();
                }
              }}
              disabled={!activeConversation || loadingAction === 'send'}
              placeholder={activeConversation ? '输入客服回复，回车发送' : '请选择会话后发送回复'}
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none disabled:cursor-not-allowed"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              type="button"
              onClick={sendReply}
              disabled={!activeConversation || !replyDraft.trim() || loadingAction === 'send'}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Send size={14} strokeWidth={1.8} />
              {loadingAction === 'send' ? '发送中' : '发送回复'}
            </button>
            <button
              type="button"
              onClick={sendAttachment}
              disabled={!activeConversation || !attachmentFile || loadingAction === 'attachment'}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: attachmentFile ? 'var(--accent)' : 'var(--bg-elevated)', color: attachmentFile ? '#fff' : 'var(--text-tertiary)' }}
            >
              <Paperclip size={14} strokeWidth={1.8} />
              {loadingAction === 'attachment' ? '上传中' : '发送附件'}
            </button>
          </div>
        </div>
      </main>

      <aside className="rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>客户信息</div>
        <div className="space-y-2 text-[12px]">
          {[
            ['客户', activeConversation?.customer || '-'],
            ['来源', activeConversation?.platform || selectedStore?.platform || '-'],
            ['店铺', activeConversation?.storeName || selectedStore?.name || '-'],
            ['订单', activeConversation?.orderHint || '待匹配'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
              <span className="truncate" style={{ color: 'var(--text-primary)' }}>{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>标签</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {(activeConversationLabels.length > 0 ? activeConversationLabels : labels.slice(0, 4).map((item) => item.title)).map((label) => (
              <span key={label} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                {label}
              </span>
            ))}
            {labels.length === 0 && <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>暂无标签</span>}
          </div>
          <div className="flex gap-2">
            <input
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              disabled={!activeConversation || loadingAction === 'labels'}
              placeholder="售后, 催发货"
              className="h-8 min-w-0 flex-1 rounded-[8px] border px-2 text-[12px] outline-none disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
            <button
              type="button"
              onClick={applyConversationLabels}
              disabled={!activeConversation || !labelDraft.trim() || loadingAction === 'labels'}
              className="h-8 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              写入
            </button>
          </div>
        </div>

        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>分配</div>
          <div className="space-y-2">
            <select
              value={selectedAssigneeId}
              onChange={(event) => {
                setSelectedAssigneeId(event.target.value);
                if (event.target.value) setSelectedTeamId('');
              }}
              disabled={!activeConversation || loadingAction === 'assign'}
              className="h-8 w-full rounded-[8px] border px-2 text-[12px] outline-none disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            >
              <option value="">选择坐席</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.email}</option>)}
            </select>
            <select
              value={selectedTeamId}
              onChange={(event) => {
                setSelectedTeamId(event.target.value);
                if (event.target.value) setSelectedAssigneeId('');
              }}
              disabled={!activeConversation || loadingAction === 'assign'}
              className="h-8 w-full rounded-[8px] border px-2 text-[12px] outline-none disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            >
              <option value="">选择团队</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <button
              type="button"
              onClick={assignConversation}
              disabled={!activeConversation || (!selectedAssigneeId && !selectedTeamId) || loadingAction === 'assign'}
              className="h-8 w-full rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              同步分配
            </button>
          </div>
        </div>

        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>内部备注</div>
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            disabled={!activeConversation || loadingAction === 'note'}
            placeholder="仅客服可见，不发给客户"
            rows={3}
            className="w-full resize-none rounded-[8px] border px-3 py-2 text-[12px] leading-5 outline-none disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={createInternalNote}
            disabled={!activeConversation || !noteDraft.trim() || loadingAction === 'note'}
            className="mt-2 h-8 w-full rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            写入内部备注
          </button>
        </div>
      </aside>
    </div>
  );

  const renderFeaturePanel = () => {
    if (activeTab === 'workbench') return renderWorkbench();
    if (activeTab === 'parity') {
      return (
        <section className="min-h-0 flex-1 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="mb-4 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>Chatwoot 功能对照</div>
          <div className="grid gap-2">
            {parityItems.map(([name, status, detail]) => {
              const tone = statusTone[status] || statusTone['待接入'];
              return (
                <div key={name} className="grid grid-cols-[220px_90px_minmax(0,1fr)] gap-3 rounded-[8px] border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</span>
                  <span className="rounded-full px-2 py-0.5 text-center font-semibold" style={{ background: tone.background, color: tone.color }}>{status}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{detail}</span>
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    if (activeTab === 'conversations') {
      return (
        <section className="min-h-0 flex-1 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>会话管理</h2>
            <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{displayConversations.length} 条来自 Chatwoot</span>
          </div>
          <div className="grid gap-2">
            {displayConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => {
                  selectConversation(conversation);
                  setActiveTab('workbench');
                }}
                className="grid grid-cols-[170px_minmax(0,1fr)_120px_90px] items-center gap-3 rounded-[8px] border px-3 py-3 text-left text-[12px]"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
              >
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{conversation.customer}</span>
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{conversation.lastMessage}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>{formatDateTime(conversation.updatedAt)}</span>
                <span className="text-right" style={{ color: conversation.status === 'human' ? '#dc2626' : 'var(--accent)' }}>{conversation.status === 'human' ? '已解决' : '处理中'}</span>
              </button>
            ))}
          </div>
        </section>
      );
    }

    if (activeTab === 'customers') {
      return (
        <section className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-4">
          <aside className="min-h-0 overflow-auto rounded-[8px] border p-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>客户资料</h2>
              <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{contacts.length} 个</span>
            </div>
            <div className="grid gap-2">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => setSelectedContactId(contact.id)}
                  className="rounded-[8px] border px-3 py-3 text-left"
                  style={{
                    borderColor: contact.id === selectedContact?.id ? 'color-mix(in srgb, var(--accent) 42%, transparent)' : 'var(--border-subtle)',
                    background: contact.id === selectedContact?.id ? 'var(--accent-soft)' : 'var(--bg-input)',
                  }}
                >
                  <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{contact.name}</div>
                  <div className="mt-1 truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{contact.phone || contact.email || '无联系方式'}</div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{formatDateTime(contact.lastActivityAt)}</div>
                </button>
              ))}
            </div>
          </aside>
          <main className="min-h-0 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            {selectedContact ? (
              <div className="grid gap-4">
                <div>
                  <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedContact.name}</h2>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {selectedContact.phone || '-'} · {selectedContact.email || '-'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <section className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>客户备注</div>
                    <div className="mb-3 max-h-[180px] space-y-2 overflow-auto">
                      {selectedContactNotes.map((note) => (
                        <div key={note.id} className="rounded-[8px] px-3 py-2 text-[12px]" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          <div>{note.content}</div>
                          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{note.authorName || '客服'} · {formatDateTime(note.createdAt)}</div>
                        </div>
                      ))}
                      {selectedContactNotes.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>暂无备注</div>}
                    </div>
                    <textarea
                      value={contactNoteDraft}
                      onChange={(event) => setContactNoteDraft(event.target.value)}
                      rows={3}
                      placeholder="写入客户备注"
                      className="w-full resize-none rounded-[8px] border px-3 py-2 text-[12px] outline-none"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    />
                    <button
                      type="button"
                      onClick={createContactNote}
                      disabled={!contactNoteDraft.trim() || loadingAction === 'contact'}
                      className="mt-2 h-8 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      保存备注
                    </button>
                  </section>
                  <section className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>自定义属性</div>
                    <textarea
                      value={contactCustomJson}
                      onChange={(event) => setContactCustomJson(event.target.value)}
                      rows={8}
                      className="w-full resize-none rounded-[8px] border px-3 py-2 font-mono text-[12px] outline-none"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    />
                    <button
                      type="button"
                      onClick={saveContactAttributes}
                      disabled={loadingAction === 'contact'}
                      className="mt-2 h-8 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      保存属性
                    </button>
                  </section>
                </div>
                <section className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>历史会话</div>
                  <div className="grid gap-2">
                    {selectedContactConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          setActiveConversationId(conversation.id);
                          setActiveTab('workbench');
                          loadMessages(conversation.id);
                        }}
                        className="grid grid-cols-[120px_minmax(0,1fr)_110px] gap-3 rounded-[8px] border px-3 py-2 text-left text-[12px]"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <span style={{ color: 'var(--text-primary)' }}>#{conversation.id}</span>
                        <span className="truncate">{conversation.lastMessage}</span>
                        <span>{conversation.status}</span>
                      </button>
                    ))}
                    {selectedContactConversations.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>暂无历史会话</div>}
                  </div>
                </section>
              </div>
            ) : (
              <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>暂无客户资料</div>
            )}
          </main>
        </section>
      );
    }

    if (activeTab === 'canned') {
      return (
        <section className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-4">
          <aside className="rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>新增话术</h2>
            <input
              value={cannedShortCode}
              onChange={(event) => setCannedShortCode(event.target.value)}
              placeholder="短码，如 ship48"
              className="mt-4 h-9 w-full rounded-[8px] border px-3 text-[13px] outline-none"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
            <textarea
              value={cannedContent}
              onChange={(event) => setCannedContent(event.target.value)}
              rows={5}
              placeholder="话术内容"
              className="mt-3 w-full resize-none rounded-[8px] border px-3 py-2 text-[13px] leading-6 outline-none"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
            <button
              type="button"
              onClick={createCannedResponse}
              disabled={!cannedShortCode.trim() || !cannedContent.trim() || loadingAction === 'canned'}
              className="mt-3 h-9 w-full rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              创建到 Chatwoot
            </button>
          </aside>
          <div className="min-h-0 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>话术库</div>
            <div className="grid gap-2">
              {cannedResponses.map((item) => (
                <article key={`${item.id}-${item.shortCode}`} className="rounded-[8px] border px-3 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>/{item.shortCode}</div>
                  <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{item.content}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    }

    if (activeTab === 'automation') {
      return (
        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>自动化规则</h2>
              <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{automationRules.length} 条规则</span>
            </div>
            <div className="grid gap-2">
              {automationRules.map((rule) => (
                <article key={rule.id} className="grid grid-cols-[minmax(0,1fr)_170px_80px] gap-3 rounded-[8px] border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rule.name}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{rule.eventName}</span>
                  <span className="text-right" style={{ color: rule.active ? 'var(--accent)' : 'var(--text-tertiary)' }}>{rule.active ? '启用' : '停用'}</span>
                </article>
              ))}
              {automationRules.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 当前没有自动化规则</div>}
            </div>
          </div>
          <aside className="overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>宏操作</h2>
            <div className="mt-4 grid gap-2">
              {macros.map((macro) => (
                <div key={macro.id} className="rounded-[8px] border px-3 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{macro.name}</div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{macro.visibility || 'global'} · {macro.actions.length} 个动作</div>
                  <button
                    type="button"
                    onClick={() => runMacro(macro.id)}
                    disabled={!activeConversation || loadingAction === 'macro'}
                    className="mt-2 h-8 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    执行到当前会话
                  </button>
                </div>
              ))}
              {macros.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 当前没有宏</div>}
            </div>
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>新建回复宏</div>
              <input
                value={macroName}
                onChange={(event) => setMacroName(event.target.value)}
                placeholder="宏名称"
                className="h-9 w-full rounded-[8px] border px-3 text-[13px] outline-none"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
              <textarea
                value={macroMessage}
                onChange={(event) => setMacroMessage(event.target.value)}
                rows={4}
                placeholder="执行宏时发送给客户的内容"
                className="mt-2 w-full resize-none rounded-[8px] border px-3 py-2 text-[13px] leading-6 outline-none"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={createMacro}
                disabled={!macroName.trim() || !macroMessage.trim() || loadingAction === 'macro'}
                className="mt-2 h-9 w-full rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                创建宏
              </button>
            </div>
          </aside>
        </section>
      );
    }

    if (activeTab === 'agents') {
      return (
        <section className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <div className="overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h2 className="mb-4 text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>坐席</h2>
            <div className="grid gap-2">
              {agents.map((agent) => (
                <div key={agent.id} className="rounded-[8px] border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name || agent.email}</div>
                  <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>{agent.email || '-'} · {agent.availability || 'unknown'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h2 className="mb-4 text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>团队</h2>
            <div className="grid gap-2">
              {teams.map((team) => (
                <div key={team.id} className="rounded-[8px] border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{team.name}</div>
                  <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>{team.description || '-'}</div>
                </div>
              ))}
              {teams.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 当前没有团队</div>}
            </div>
          </div>
        </section>
      );
    }

    if (activeTab === 'reports') {
      const metrics = [
        ['会话数', 'conversations_count'],
        ['入站消息', 'incoming_messages_count'],
        ['出站消息', 'outgoing_messages_count'],
        ['首次响应', 'avg_first_response_time'],
        ['解决时长', 'avg_resolution_time'],
        ['解决数', 'resolved_conversations_count'],
      ];
      return (
        <section className="min-h-0 flex-1 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <h2 className="mb-4 text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>7 天报表</h2>
          <div className="grid grid-cols-3 gap-3">
            {metrics.map(([label, key]) => (
              <div key={key} className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
                <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                <div className="mt-2 text-[24px] font-semibold" style={{ color: 'var(--text-primary)' }}>{getReportValue(reportSummary, key)}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (activeTab === 'settings') {
      return (
        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-4">
          <main className="min-h-0 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>收件箱与店铺通道</h2>
              <button
                type="button"
                onClick={loadStoreResources}
                disabled={loadingAction === 'resources'}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <RefreshCcw size={14} strokeWidth={1.8} />
                刷新
              </button>
            </div>

            <div className="grid gap-3">
              <section className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>当前 Chatwoot Inbox</div>
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>平台</span>
                    <div className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedStore?.platform || '-'}</div>
                  </div>
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Inbox ID</span>
                    <div className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedInbox?.id || selectedStore?.inboxId || '-'}</div>
                  </div>
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>渠道类型</span>
                    <div className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedInbox?.channelType || '未知'}</div>
                  </div>
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>访问凭证</span>
                    <div className="mt-1 font-semibold" style={{ color: selectedStore?.apiToken ? 'var(--accent)' : 'var(--text-tertiary)' }}>{selectedStore?.apiToken ? '已配置，不展示明文' : '未配置'}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_150px_90px] gap-2">
                  <input
                    value={inboxName}
                    onChange={(event) => setInboxName(event.target.value)}
                    placeholder="收件箱名称"
                    className="h-9 min-w-0 rounded-[8px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                  <label className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={inboxAutoAssignment}
                      onChange={(event) => setInboxAutoAssignment(event.target.checked)}
                    />
                    自动分配
                  </label>
                  <button
                    type="button"
                    onClick={saveInboxSettings}
                    disabled={!selectedInbox || loadingAction === 'storeSettings'}
                    className="h-9 rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    保存
                  </button>
                </div>
              </section>

              <section className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>AI 自动回复 Webhook</div>
                <div className="grid gap-2 text-[12px]">
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
                    <div className="mb-1" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 本机可访问时</div>
                    <code className="break-all" style={{ color: 'var(--text-primary)' }}>{aiWebhookUrls.direct}</code>
                  </div>
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
                    <div className="mb-1" style={{ color: 'var(--text-tertiary)' }}>Docker Desktop</div>
                    <code className="break-all" style={{ color: 'var(--text-primary)' }}>{aiWebhookUrls.docker}</code>
                  </div>
                  <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
                    <div className="mb-1" style={{ color: 'var(--text-tertiary)' }}>Colima / Lima</div>
                    <code className="break-all" style={{ color: 'var(--text-primary)' }}>{aiWebhookUrls.colima}</code>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                  在 Chatwoot 的 Webhooks 中订阅 message_created；梅奥后端会忽略客服发出的 outgoing 消息，只处理客户 incoming 消息。
                </p>
              </section>

              <section className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Webhook 集成</div>
                  <button
                    type="button"
                    onClick={() => setSelectedWebhookId('')}
                    className="h-7 rounded-[8px] px-2 text-[11px] font-semibold"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    新建
                  </button>
                </div>
                <div className="mb-3 grid gap-2">
                  {webhooks.map((webhook) => (
                    <button
                      key={webhook.id}
                      type="button"
                      onClick={() => setSelectedWebhookId(webhook.id)}
                      className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-[8px] border px-3 py-2 text-left text-[12px]"
                      style={{
                        borderColor: webhook.id === selectedWebhookId ? 'color-mix(in srgb, var(--accent) 42%, transparent)' : 'var(--border-subtle)',
                        background: webhook.id === selectedWebhookId ? 'var(--accent-soft)' : 'transparent',
                      }}
                    >
                      <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{webhook.name || `#${webhook.id}`}</span>
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{webhook.url}</span>
                    </button>
                  ))}
                  {webhooks.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 当前没有 Webhook</div>}
                </div>
                <div className="grid gap-2">
                  <input
                    value={webhookName}
                    onChange={(event) => setWebhookName(event.target.value)}
                    placeholder="Webhook 名称"
                    className="h-9 rounded-[8px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                  <input
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    placeholder="https://example.com/chatwoot-hook"
                    className="h-9 rounded-[8px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                  <input
                    value={webhookSubscriptions}
                    onChange={(event) => setWebhookSubscriptions(event.target.value)}
                    placeholder="message_created,conversation_created"
                    className="h-9 rounded-[8px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                  <button
                    type="button"
                    onClick={saveWebhook}
                    disabled={!webhookName.trim() || !webhookUrl.trim() || loadingAction === 'storeSettings'}
                    className="h-9 rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {selectedWebhookId ? '更新 Webhook' : '创建 Webhook'}
                  </button>
                </div>
              </section>
            </div>
          </main>

          <aside className="min-h-0 overflow-auto rounded-[8px] border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>店铺活动</h2>
            <div className="mt-4 grid gap-2">
              {campaigns.map((campaign) => (
                <article key={campaign.id} className="rounded-[8px] border px-3 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{campaign.title || `活动 #${campaign.id}`}</div>
                    <span className="text-[11px] font-semibold" style={{ color: campaign.enabled ? 'var(--accent)' : 'var(--text-tertiary)' }}>{campaign.enabled ? '启用' : '停用'}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{campaign.message || '-'}</p>
                </article>
              ))}
              {campaigns.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chatwoot 当前没有活动</div>}
            </div>
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>新建活动</div>
              <input
                value={campaignTitle}
                onChange={(event) => setCampaignTitle(event.target.value)}
                placeholder="活动标题"
                className="h-9 w-full rounded-[8px] border px-3 text-[13px] outline-none"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
              <textarea
                value={campaignMessage}
                onChange={(event) => setCampaignMessage(event.target.value)}
                rows={5}
                placeholder="发送给客户的活动内容"
                className="mt-2 w-full resize-none rounded-[8px] border px-3 py-2 text-[13px] leading-6 outline-none"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={createCampaign}
                disabled={!campaignTitle.trim() || !campaignMessage.trim() || loadingAction === 'storeSettings'}
                className="mt-2 h-9 w-full rounded-[8px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                创建到 Chatwoot
              </button>
            </div>
          </aside>
        </section>
      );
    }

    return (
      <section className="min-h-0 flex-1 rounded-[8px] border p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>功能加载中</h2>
      </section>
    );
  };

  if (!selectedStore) return renderStoreAccess();

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={backToStores}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={15} strokeWidth={1.8} />
            店铺切换 · 返回店铺列表
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[24px] font-semibold tracking-[0]" style={{ color: 'var(--text-primary)' }}>{selectedStore.name}</h1>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {selectedStore.platform} · {selectedStore.shopHint}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadConversations}
            disabled={Boolean(loadingAction) || !canUseSelectedStore}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <RefreshCcw size={15} strokeWidth={1.8} />
            {loadingAction === 'stores' ? '拉取中' : '拉取会话'}
          </button>
          <button
            type="button"
            onClick={openConsole}
            disabled={!consoleUrl}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            style={{ background: consoleUrl ? 'var(--accent)' : 'var(--bg-surface)', color: consoleUrl ? '#fff' : 'var(--text-tertiary)' }}
          >
            <ExternalLink size={15} strokeWidth={1.8} />
            打开 Chatwoot 控制台
          </button>
        </div>
      </div>

      {(statusMessage || errorMessage) && (
        <div
          className="mb-3 rounded-[8px] border px-3 py-2 text-[12px]"
          style={{
            borderColor: errorMessage ? 'rgba(220,38,38,0.22)' : 'var(--border-subtle)',
            background: errorMessage ? 'rgba(220,38,38,0.08)' : 'var(--accent-soft)',
            color: errorMessage ? '#dc2626' : 'var(--accent)',
          }}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      <nav className="mb-3 flex flex-wrap gap-2">
        {workspaceTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold"
              style={{
                background: selected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                color: selected ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={14} strokeWidth={1.8} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {renderFeaturePanel()}
    </div>
  );
};

export default AiCustomerServiceModule;
