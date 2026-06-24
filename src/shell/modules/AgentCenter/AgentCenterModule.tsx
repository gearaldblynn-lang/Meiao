import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../../types';
import {
  createChatSession,
  deleteChatSession,
  deleteUserAgentHistory,
  fetchAgentSummaries,
  fetchChatAgents,
  fetchChatMessages,
  fetchChatSessions,
  fetchSystemConfig,
  sendChatMessage,
  type ChatProgressEvent,
  updateChatSession,
} from '../../../services/internalApi';
import AgentCenterManager from '../../../modules/AgentCenter/AgentCenterManager';
import AgentCenterChatWorkspace from '../../../modules/AgentCenter/AgentCenterChatWorkspace';
import { ComposerAttachment } from '../../../modules/AgentCenter/ChatComposer';
import { resolveActiveAgentId } from '../../../modules/AgentCenter/agentCenterUtils.mjs';
import { filterChatModelsByAllowlist } from '../../../modules/AgentCenter/chatModelAllowlist';
import { resolveSessionReasoningLevel } from '../../../modules/AgentCenter/chatReasoningDefaults.mjs';
import { getVisibleMessageText, resolveRegenerateRequest } from '../../../modules/AgentCenter/chatMessageDisplay.mjs';
import { MAX_FILES_PER_BATCH } from '../../../modules/AgentCenter/folderZipUpload';
import { LegacyFaIcon } from '../../../components/ui/workspacePrimitives';
import { copyTextToClipboard } from '../../../utils/clipboard.mjs';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onHandoff?: (target: ModuleInterfaceId, payload: Record<string, unknown>) => void;
}

type ChatAttachmentPayload = {
  name: string;
  kind?: 'image' | 'file';
  url?: string;
  assetId?: string;
  mimeType?: string;
};
type AgentMessageMetadata = NonNullable<AgentChatMessage['metadata']>;
type RunSubmissionMode = 'idle' | 'insert' | 'queue';
type ChatSubmissionInput = {
  content: string;
  sourceAttachments: Array<ComposerAttachment | ChatAttachmentPayload>;
  requestMode: 'chat' | 'image_generation';
  selectedModelOverride?: string;
  reasoningLevelOverride?: string | null;
  webSearchEnabledOverride?: boolean;
  restoreDraft: string;
  restoreAttachments: ComposerAttachment[];
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const AGENT_CENTER_UI_STATE_KEY = 'MEIAO_AGENT_CENTER_UI_STATE';
const FINAL_EXECUTION_PROGRESS_STAGES = new Set(['tool_calling', 'generating', 'image_generating', 'image_validating', 'image_validation_failed', 'image_regenerating', 'image_ready', 'syncing']);
const isUncertainSendFailure = (error: any) =>
  !(
    error?.name === 'AbortError'
    || error?.message === 'INTERRUPTED'
    || String(error?.message || '').includes('aborted')
  )
  && ['timeout', 'network_error', 'server_error'].includes(error?.code);
const isPendingAgentRunMessage = (message?: AgentChatMessage | null) => {
  const status = String(message?.metadata?.status || '').trim().toLowerCase();
  return message?.role === 'assistant' && (Boolean(message?.metadata?.pending) || status === 'pending' || status === 'running');
};
const mergePendingLocalMessages = (
  currentMessages: AgentChatMessage[],
  incomingMessages: AgentChatMessage[],
  sessionId: string,
) => {
  const incomingIds = new Set(incomingMessages.map((item) => item.id));
  const incomingClientRequestIds = new Set(
    incomingMessages
      .map((item) => String(item.metadata?.clientRequestId || '').trim())
      .filter(Boolean),
  );
  const localPendingMessages = currentMessages.filter((item) => {
    const clientRequestId = String(item.metadata?.clientRequestId || '').trim();
    return item.sessionId === sessionId
      && Boolean(item.metadata?.pending)
      && !incomingIds.has(item.id)
      && (!clientRequestId || !incomingClientRequestIds.has(clientRequestId));
  });
  return [...incomingMessages, ...localPendingMessages]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
};

const readAgentCenterUiState = () => {
  try {
    const raw = sessionStorage.getItem(AGENT_CENTER_UI_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const moduleCopy = {
  plaza: {
    title: '智能体广场',
    detail: '选择已发布智能体，进入会话、查看历史和执行素材分析。',
  },
  factory: {
    title: '智能体工厂',
    detail: '制作、配置、版本发布、知识库绑定和进入智能体工作室。',
  },
};

const AgentCenterShellStyles = () => (
  <style>{`
    .agent-center-shell-scope {
      --agent-panel: var(--bg-surface);
      --agent-panel-strong: var(--bg-elevated);
      --agent-hairline: color-mix(in srgb, var(--border-subtle) 72%, transparent);
    }
    .agent-center-shell-scope [class*="bg-white"],
    .agent-center-shell-scope [class*="bg-slate-50"],
    .agent-center-shell-scope [class*="bg-slate-100"],
    .agent-center-shell-scope [class*="bg-\\[rgba(255,255,255"],
    .agent-center-shell-scope [class*="bg-\\[rgba(248,250,252"],
    .agent-center-shell-scope [class*="bg-\\[linear-gradient(180deg,rgba(255,255,255"],
    .agent-center-shell-scope [class*="bg-\\[linear-gradient(135deg,rgba(236,254,255"],
    .agent-center-shell-scope [class*="bg-\\[linear-gradient(135deg,rgba(255,255,255"] {
      background: var(--agent-panel) !important;
    }
    .agent-center-shell-scope [class*="text-slate-950"],
    .agent-center-shell-scope [class*="text-slate-900"],
    .agent-center-shell-scope [class*="text-slate-800"],
    .agent-center-shell-scope [class*="text-slate-700"] {
      color: var(--text-primary) !important;
    }
    .agent-center-shell-scope [class*="text-slate-600"],
    .agent-center-shell-scope [class*="text-slate-500"] {
      color: var(--text-secondary) !important;
    }
    .agent-center-shell-scope [class*="text-slate-400"],
    .agent-center-shell-scope [class*="text-slate-300"] {
      color: var(--text-tertiary) !important;
    }
    .agent-center-shell-scope [class*="border-slate-"],
    .agent-center-shell-scope [class*="border-white"] {
      border-color: var(--agent-hairline) !important;
    }
    .agent-center-shell-scope input,
    .agent-center-shell-scope textarea,
    .agent-center-shell-scope select {
      background: var(--bg-input) !important;
      border-color: var(--border-subtle) !important;
      color: var(--text-primary) !important;
    }
    .agent-center-shell-scope input::placeholder,
    .agent-center-shell-scope textarea::placeholder {
      color: var(--text-tertiary) !important;
    }
    .agent-center-shell-scope [class*="backdrop-blur"] {
      backdrop-filter: none !important;
    }
    .agent-center-shell-scope [class*="bg-\\[linear-gradient"] {
      background: var(--agent-panel-strong) !important;
    }
    .agent-center-shell-scope button[class*="bg-slate-900"] {
      background: var(--accent) !important;
      color: #fff !important;
    }
    .agent-center-shell-scope [class*="bg-cyan-50"],
    .agent-center-shell-scope [class*="bg-emerald-50"],
    .agent-center-shell-scope [class*="bg-amber-50"],
    .agent-center-shell-scope [class*="bg-rose-50"] {
      background: var(--accent-soft) !important;
    }
    .agent-center-shell-scope [class*="shadow-"] {
      box-shadow: none !important;
    }
    .agent-center-shell-scope .shadow-none {
      box-shadow: none !important;
    }
    .agent-composer-config-menu,
    .agent-composer-upload-menu,
    .agent-center-shell-scope .agent-composer-config-menu,
    .agent-center-shell-scope .agent-composer-upload-menu {
      background: rgba(255, 255, 255, 0.78) !important;
      border-color: rgba(255, 255, 255, 0.72) !important;
      backdrop-filter: blur(28px) saturate(1.22) !important;
      box-shadow: 0 24px 70px rgba(15,23,42,0.16) !important;
    }
    .agent-composer-config-popout,
    .agent-center-shell-scope .agent-composer-config-popout {
      background: rgba(255, 255, 255, 0.46) !important;
      border-color: transparent !important;
      backdrop-filter: blur(10px) saturate(1.08) !important;
      box-shadow: none !important;
    }
    .agent-center-shell-scope [class*="text-cyan-"],
    .agent-center-shell-scope [class*="text-emerald-"],
    .agent-center-shell-scope [class*="text-amber-"],
    .agent-center-shell-scope [class*="text-rose-"] {
      color: var(--accent) !important;
    }
    .agent-center-shell-scope .rounded-\\[28px\\],
    .agent-center-shell-scope .rounded-\\[30px\\],
    .agent-center-shell-scope .rounded-\\[24px\\],
    .agent-center-shell-scope .rounded-\\[26px\\] {
      border-radius: 20px !important;
    }
    .agent-center-shell-scope h3,
    .agent-center-shell-scope h4 {
      letter-spacing: 0 !important;
    }
    .agent-center-shell-scope select {
      appearance: none;
    }
  `}</style>
);

const MessageActionTooltip = ({ label }: { label: string }) => (
  <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition group-hover:opacity-100 group-focus-visible:opacity-100">
    {label}
  </span>
);

const AgentCenterModule: React.FC<Props> = ({ currentUser = null, internalMode = false, onHandoff }) => {
  const initialUiState = readAgentCenterUiState();
  const [workspaceMode, setWorkspaceMode] = useState<'factory' | 'plaza'>(initialUiState.workspaceMode === 'factory' ? 'factory' : 'plaza');
  const [chatAgents, setChatAgents] = useState<AgentSummary[]>([]);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(String(initialUiState.selectedAgentId || ''));
  const [selectedSessionId, setSelectedSessionId] = useState(String(initialUiState.selectedSessionId || ''));
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [chatModels, setChatModels] = useState<SystemPublicConfig['agentModels']['chat']>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [imageModeEnabled, setImageModeEnabled] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendingRequestMode, setSendingRequestMode] = useState<'chat' | 'image_generation' | null>(null);
  const [pendingAssistantMessageId, setPendingAssistantMessageId] = useState('');
  const [workspacePage, setWorkspacePage] = useState<'plaza' | 'chat'>(initialUiState.workspacePage === 'chat' ? 'chat' : 'plaza');
  const [sessionsCollapsed, setSessionsCollapsed] = useState(Boolean(initialUiState.sessionsCollapsed));
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [factoryView, setFactoryView] = useState<'overview' | 'manager'>('overview');
  const [factoryAgents, setFactoryAgents] = useState<AgentSummary[]>([]);
  const [pendingAutoSubmission, setPendingAutoSubmission] = useState<ChatSubmissionInput | null>(null);
  const [queuedMessageCount, setQueuedMessageCount] = useState(0);
  const sendAbortControllerRef = useRef<AbortController | null>(null);
  const pendingRestoreRef = useRef<{ draft: string; attachments: ComposerAttachment[]; userMessageId: string; assistantMessageId: string } | null>(null);
  const interruptingChatSubmissionRef = useRef<ChatSubmissionInput | null>(null);
  const previousWorkspaceModeRef = useRef(workspaceMode);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const loadChatRequestSeqRef = useRef(0);
  const messageLoadSeqRef = useRef(0);
  const canManage = Boolean(internalMode && currentUser?.role === 'admin');
  const canAccessAgentCenter = Boolean(internalMode && currentUser);

  const setActiveSessionId = (sessionId: string) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
  };

  const applyMessagesForSession = (sessionId: string, nextMessages: AgentChatMessage[]) => {
    if (selectedSessionIdRef.current !== sessionId) return false;
    setMessages(nextMessages);
    return true;
  };

  const updateMessagesForSession = (
    sessionId: string,
    updater: (prev: AgentChatMessage[]) => AgentChatMessage[],
  ) => {
    if (selectedSessionIdRef.current !== sessionId) return false;
    setMessages(updater);
    return true;
  };

  const updateAssistantProgress = (
    sessionId: string,
    assistantMessageId: string,
    event: ChatProgressEvent,
  ) => {
    const eventType = 'type' in event ? event.type : event.stage;
    if (eventType === 'compressed') {
      const foldedRounds = Number(event.foldedRounds || 0);
      const noticeId = `compressed-${assistantMessageId}`;
      updateMessagesForSession(sessionId, (prev) => (
        prev.some((item) => item.id === noticeId)
          ? prev
          : [
              ...prev,
              {
                id: noticeId,
                sessionId,
                userId: currentUser?.id || '',
                role: 'system',
                content: `较早的 ${foldedRounds} 轮对话已折叠为摘要`,
                attachments: [],
                createdAt: Date.now(),
                metadata: { localOnly: true, progressStage: 'compressed' },
              },
            ]
      ));
      return;
    }

    updateMessagesForSession(sessionId, (prev) => prev.map((item) => {
      if (item.id !== assistantMessageId) return item;
      if (eventType === 'streaming') {
        const streamedContent = `${String(item.metadata?.streamedContent || '')}${event.delta || ''}`;
        return {
          ...item,
          content: streamedContent,
          metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage: 'streaming', streamedContent },
        };
      }
      if (eventType === 'tool_calling') {
        return {
          ...item,
          content: '分析需求中...',
          metadata: {
            ...(item.metadata || {}),
            pending: true,
            progress: true,
            progressStage: 'tool_calling',
            toolCall: { tool: event.tool || '', args: event.args || {} },
          },
        };
      }
      if (eventType === 'searching_knowledge') {
        return {
          ...item,
          content: '检索知识库中...',
          metadata: {
            ...(item.metadata || {}),
            pending: true,
            progress: true,
            progressStage: 'searching_knowledge',
          },
        };
      }
      if (eventType === 'image_generating') {
        const modelLabel = event.model ? `（${event.model}）` : '';
        return {
          ...item,
          content: `生成图片中${modelLabel}...`,
          metadata: {
            ...(item.metadata || {}),
            pending: true,
            progress: true,
            progressStage: 'image_generating',
            imageModel: event.model || '',
            imagePhase: event.phase || '',
          },
        };
      }
      if (eventType === 'image_validating' || eventType === 'image_validation_failed' || eventType === 'image_regenerating') {
        return {
          ...item,
          content: '生成图片中...',
          metadata: {
            ...(item.metadata || {}),
            pending: true,
            progress: true,
            progressStage: eventType,
            imageValidationAttempt: event.attempt || item.metadata?.imageValidationAttempt || 0,
            imageValidationIssues: event.issues || item.metadata?.imageValidationIssues || [],
          },
        };
      }
      if (eventType === 'image_ready') {
        const imageUrl = String(event.imageUrl || '').trim();
        const existingAttachments = Array.isArray(item.attachments) ? item.attachments : [];
        const existingUrls = Array.isArray(item.metadata?.imageResultUrls)
          ? item.metadata.imageResultUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
          : [];
        const imageResultUrls = imageUrl && !existingUrls.includes(imageUrl)
          ? [...existingUrls, imageUrl]
          : existingUrls;
        const attachments = imageUrl && !existingAttachments.some((attachment) => attachment.url === imageUrl)
          ? [...existingAttachments, { name: `生成图片 ${imageResultUrls.length || 1}`, url: imageUrl, kind: 'image' as const }]
          : existingAttachments;
        return {
          ...item,
          content: imageUrl ? '图片已生成，正在整理回复...' : item.content,
          attachments,
          metadata: {
            ...(item.metadata || {}),
            pending: true,
            progress: true,
            progressStage: 'image_ready',
            imageResultUrls,
            imagePlan: (event.imagePlan || item.metadata?.imagePlan || null) as AgentMessageMetadata['imagePlan'],
          },
        };
      }
      if (eventType === 'error') {
        return {
          ...item,
          content: event.message || '聊天回复失败。',
          metadata: { ...(item.metadata || {}), pending: false, progress: false, progressStage: 'failed' },
        };
      }
      const round = 'round' in event ? Number(event.round || 0) : 0;
      let content: string;
      let progressStage: string;
      if (eventType === 'thinking') {
        content = round <= 1 ? '正在思考...' : `第 ${round} 轮深度思考中...`;
        progressStage = 'thinking';
      } else {
        const docs = ('docTitles' in event ? event.docTitles || [] : []).slice(0, 3);
        if (round === 0) {
          content = docs.length > 0
            ? `已读取：${docs.join('、')}${('docTitles' in event && (event.docTitles || []).length > 3) ? ` 等 ${(event.docTitles || []).length} 份资料` : ''}`
            : `已检索到 ${'chunkCount' in event ? event.chunkCount || 0 : 0} 条相关内容`;
        } else {
          const queryStr = ('queries' in event ? event.queries || [] : []).slice(0, 2).join('、');
          content = docs.length > 0
            ? `检索「${queryStr}」→ ${docs.join('、')}`
            : `检索「${queryStr}」未找到新内容`;
        }
        progressStage = 'replying';
      }
      return { ...item, content, metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage } };
    }));
  };

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const activePendingRunMessage = useMemo(
    () => messages.find((message) => message.sessionId === selectedSessionId && isPendingAgentRunMessage(message)) || null,
    [messages, selectedSessionId],
  );
  const activePendingClientRequestId = String(activePendingRunMessage?.metadata?.clientRequestId || '').trim();
  const hasActivePendingRun = Boolean(activePendingRunMessage);
  const activeRunProgressStage = String(activePendingRunMessage?.metadata?.progressStage || '').trim();
  const activeRunRequestMode = String(activePendingRunMessage?.metadata?.requestMode || sendingRequestMode || '').trim();
  const imageExecutionStageActive = activeRunRequestMode === 'image_generation' && FINAL_EXECUTION_PROGRESS_STAGES.has(activeRunProgressStage);
  const finalExecutionActive = FINAL_EXECUTION_PROGRESS_STAGES.has(activeRunProgressStage) || imageExecutionStageActive;
  const runSubmissionMode: RunSubmissionMode = !sendingMessage && !hasActivePendingRun
    ? 'idle'
    : finalExecutionActive ? 'queue' : 'insert';
  const selectedAgent = useMemo(() => {
    const activeAgentId = resolveActiveAgentId({
      workspacePage,
      selectedAgentId,
      selectedSession,
    });
    return chatAgents.find((agent) => agent.id === activeAgentId) || null;
  }, [chatAgents, selectedAgentId, selectedSession, workspacePage]);
  const recentAgents = useMemo(() => {
    const seen = new Set<string>();
    return sessions
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .map((session) => chatAgents.find((agent) => agent.id === session.agentId) || null)
      .filter((agent): agent is AgentSummary => Boolean(agent))
      .filter((agent) => {
        if (seen.has(agent.id)) return false;
        seen.add(agent.id);
        return true;
      });
  }, [chatAgents, sessions]);
  const availableChatModels = useMemo(() => {
    return filterChatModelsByAllowlist(chatModels, selectedAgent?.allowedChatModels || []);
  }, [chatModels, selectedAgent?.allowedChatModels]);
  const factoryStats = useMemo(() => ({
    total: factoryAgents.length,
    published: factoryAgents.filter((agent) => agent.status === 'published').length,
    draft: factoryAgents.filter((agent) => agent.status === 'draft').length,
  }), [factoryAgents]);

  const resolveReasoningLevelForModel = (modelId: string, requestedReasoningLevel: string | null = null) => {
    const capability = availableChatModels.find((item) => item.id === modelId);
    return capability?.supportsReasoningLevel
      ? resolveSessionReasoningLevel({
          reasoningLevels: capability.reasoningLevels || [],
          requestedReasoningLevel,
        })
      : null;
  };

  const refreshChatCatalog = async () => {
    const agentResult = await fetchChatAgents();
    setChatAgents(agentResult.agents);
  };

  const refreshChatSessions = async () => {
    const sessionResult = await fetchChatSessions();
    setSessions(sessionResult.sessions);
    return sessionResult.sessions;
  };

  const loadChat = async (preferredAgentId = '', preferredSessionId = '') => {
    const requestSeq = ++loadChatRequestSeqRef.current;
    const [agentResult, sessionResult, systemConfigResult] = await Promise.all([
      fetchChatAgents(),
      fetchChatSessions(),
      fetchSystemConfig(),
    ]);
    if (requestSeq !== loadChatRequestSeqRef.current) return;
    setChatAgents(agentResult.agents);
    setSessions(sessionResult.sessions);
    setChatModels(systemConfigResult.config.agentModels?.chat || []);
    const nextAgentId = preferredAgentId || preferredSessionId
      ? sessionResult.sessions.find((item) => item.id === preferredSessionId)?.agentId || preferredAgentId
      : selectedAgentId || agentResult.agents[0]?.id || '';
    setSelectedAgentId(nextAgentId);
    const preferredSession = preferredSessionId
      ? sessionResult.sessions.find((item) => item.id === preferredSessionId)
      : sessionResult.sessions.find((item) => item.agentId === nextAgentId) || sessionResult.sessions[0] || null;
    const targetSessionId = preferredSession?.id || '';
    setActiveSessionId(targetSessionId);
    if (preferredSession?.id) {
      const messageResult = await fetchChatMessages(preferredSession.id);
      if (requestSeq !== loadChatRequestSeqRef.current) return;
      applyMessagesForSession(preferredSession.id, messageResult.messages);
    } else {
      setMessages([]);
    }
  };

  useEffect(() => {
    if (!canAccessAgentCenter) return;
    setLoading(true);
    setErrorMessage('');
    loadChat()
      .catch((error: any) => setErrorMessage(error.message || '智能体中心初始化失败'))
      .finally(() => setLoading(false));
  }, [canAccessAgentCenter]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(AGENT_CENTER_UI_STATE_KEY, JSON.stringify({
        workspaceMode,
        workspacePage,
        selectedAgentId,
        selectedSessionId,
        sessionsCollapsed,
      }));
    } catch {
      // ignore storage errors
    }
  }, [workspaceMode, workspacePage, selectedAgentId, selectedSessionId, sessionsCollapsed]);

  useEffect(() => {
    if (!canAccessAgentCenter || workspaceMode !== 'plaza') return;
    void refreshChatCatalog().catch(() => {});
  }, [canAccessAgentCenter, workspaceMode]);

  useEffect(() => {
    if (!canAccessAgentCenter || !canManage || workspaceMode !== 'factory') return;
    fetchAgentSummaries()
      .then((result) => setFactoryAgents(result.agents || []))
      .catch(() => setFactoryAgents([]));
  }, [canAccessAgentCenter, canManage, workspaceMode]);

  useEffect(() => {
    if (previousWorkspaceModeRef.current === workspaceMode) return;
    previousWorkspaceModeRef.current = workspaceMode;
    if (workspaceMode !== 'plaza') return;
    setWorkspacePage('plaza');
    setActiveSessionId('');
    setMessages([]);
    setImageModeEnabled(false);
  }, [workspaceMode]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    const targetSessionId = selectedSessionId;
    const requestSeq = ++messageLoadSeqRef.current;
    fetchChatMessages(targetSessionId)
      .then((result) => {
        if (requestSeq !== messageLoadSeqRef.current) return;
        updateMessagesForSession(targetSessionId, (current) => mergePendingLocalMessages(current, result.messages, targetSessionId));
      })
      .catch((error: any) => setErrorMessage(error.message || '会话消息读取失败'));
  }, [selectedSessionId]);

  useEffect(() => {
    if (!sendingMessage || !sendingRequestMode) {
      return;
    }
    const stages = sendingRequestMode === 'image_generation'
      ? [
          { delay: 0, label: '需求分析中', stage: 'analyzing' },
          { delay: 900, label: '生图参数整理中', stage: 'planning' },
          { delay: 2200, label: '图像生成中', stage: 'generating' },
          { delay: 4200, label: '结果整理中', stage: 'finalizing' },
        ]
      : [
          { delay: 0, label: '思考中', stage: 'thinking' },
          { delay: 900, label: '组织回复中', stage: 'replying' },
    ];
    const timers = stages.map((stage) => window.setTimeout(() => {
      const targetSessionId = selectedSessionIdRef.current;
      setMessages((prev) => prev.map((item) => (
        item.sessionId === targetSessionId && item.id === pendingAssistantMessageId
          ? {
              ...item,
              content: stage.label,
              metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage: stage.stage },
            }
          : item
      )));
    }, stage.delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [sendingMessage, sendingRequestMode, pendingAssistantMessageId]);

  useEffect(() => {
    if (!selectedSession) {
      const fallbackModel = selectedAgent?.defaultChatModel || availableChatModels[0]?.id || '';
      setSelectedModel(fallbackModel);
      setReasoningLevel(resolveReasoningLevelForModel(fallbackModel, null));
      setWebSearchEnabled(false);
      setAttachments([]);
      setImageModeEnabled(false);
      return;
    }
    const matchedModel = availableChatModels.find((item) => item.id === selectedSession.selectedModel);
    const nextModel = matchedModel?.id
      || selectedAgent?.defaultChatModel
      || availableChatModels[0]?.id
      || '';
    setSelectedModel(nextModel);
    setReasoningLevel(resolveReasoningLevelForModel(nextModel, selectedSession.reasoningLevel || null));
    setWebSearchEnabled(Boolean(selectedSession.webSearchEnabled));
    setImageModeEnabled(Boolean(selectedSession.lastImageMode));
  }, [selectedSession?.id, selectedSession?.selectedModel, selectedSession?.reasoningLevel, selectedSession?.webSearchEnabled, selectedSession?.lastImageMode, availableChatModels, selectedAgent?.defaultChatModel]);

  const runAction = async (action: () => Promise<void>) => {
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await action();
    } catch (error: any) {
      setErrorMessage(error.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const syncCompletedMessageAfterTimeout = async (sessionId: string, clientRequestId: string) => {
    const deadline = Date.now() + 210_000;
    while (Date.now() < deadline) {
      try {
        const result = await fetchChatMessages(sessionId);
        const userMessage = result.messages.find((item) => item.role === 'user' && item.metadata?.clientRequestId === clientRequestId);
        const assistantMessage = result.messages.find((item) => item.role === 'assistant' && item.metadata?.clientRequestId === clientRequestId && !isPendingAgentRunMessage(item));
        const fallbackAssistantMessage = userMessage
          ? result.messages
              .filter((item) => item.role === 'assistant' && !isPendingAgentRunMessage(item) && Number(item.createdAt || 0) >= Number(userMessage.createdAt || 0))
              .slice(-1)[0]
          : null;
        if (userMessage && (assistantMessage || fallbackAssistantMessage)) {
          return {
            messages: result.messages,
            userMessage,
            assistantMessage: assistantMessage || fallbackAssistantMessage,
          };
        }
      } catch {
        // ignore transient sync errors and keep polling until deadline
      }
      await wait(3000);
    }
    return null;
  };

  useEffect(() => {
    if (!selectedSessionId || !activePendingClientRequestId) return;
    let disposed = false;
    let polling = false;
    const pollPendingRun = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await fetchChatMessages(selectedSessionId);
        if (disposed) return;
        updateMessagesForSession(selectedSessionId, (current) => mergePendingLocalMessages(current, result.messages, selectedSessionId));
        const stillPending = result.messages.some((message) => (
          message.sessionId === selectedSessionId
          && String(message.metadata?.clientRequestId || '').trim() === activePendingClientRequestId
          && isPendingAgentRunMessage(message)
        ));
        if (!stillPending) {
          await refreshChatSessions();
        }
      } catch {
        // keep the persisted pending message visible; the next poll can recover.
      } finally {
        polling = false;
      }
    };
    void pollPendingRun();
    const timer = window.setInterval(() => {
      void pollPendingRun();
    }, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [selectedSessionId, activePendingClientRequestId]);

  const handleCreateSession = (agentId: string) => runAction(async () => {
    const result = await createChatSession(agentId);
    setSelectedAgentId(agentId);
    setWorkspacePage('chat');
    await loadChat(agentId, result.session.id);
    if (result.openingRemarks?.trim()) {
      applyMessagesForSession(result.session.id, [{
        id: `opening-${result.session.id}`,
        sessionId: result.session.id,
        userId: '',
        role: 'assistant',
        content: result.openingRemarks.trim(),
        attachments: [],
        createdAt: Date.now(),
        metadata: { isOpeningRemarks: true },
      }]);
    }
  });

  const handleEnterAgent = (agentId: string) => runAction(async () => {
    await refreshChatCatalog();
    const sessionResult = await fetchChatSessions();
    setSessions(sessionResult.sessions);
    setSelectedAgentId(agentId);
    setWorkspacePage('chat');
    const matched = sessionResult.sessions.find((item) => item.agentId === agentId);
    if (matched) {
      await loadChat(agentId, matched.id);
      return;
    }
    const result = await createChatSession(agentId);
    await loadChat(agentId, result.session.id);
    if (result.openingRemarks?.trim()) {
      applyMessagesForSession(result.session.id, [{
        id: `opening-${result.session.id}`,
        sessionId: result.session.id,
        userId: '',
        role: 'assistant',
        content: result.openingRemarks.trim(),
        attachments: [],
        createdAt: Date.now(),
        metadata: { isOpeningRemarks: true },
      }]);
    }
  });

  const handleDeleteSession = (sessionId: string) => runAction(async () => {
    await deleteChatSession(sessionId);
    const fallbackSession = sessions.find((item) => item.id !== sessionId && item.agentId === selectedAgentId) || sessions.find((item) => item.id !== sessionId) || null;
    await loadChat(selectedAgentId, fallbackSession?.id || '');
  });

  const handleDeleteAgentHistory = (agentId: string) => runAction(async () => {
    await deleteUserAgentHistory(agentId);
    if (selectedAgentId === agentId) {
      setActiveSessionId('');
      setMessages([]);
      setWorkspacePage('plaza');
    }
    await loadChat(agentId, '');
  });

  const syncSessionOptions = async (payload: Partial<Pick<AgentChatSession, 'selectedModel' | 'reasoningLevel' | 'webSearchEnabled' | 'lastImageMode'>>) => {
    if (!selectedSessionId) return;
    const result = await updateChatSession(selectedSessionId, payload);
    setSessions((prev) => prev.map((item) => item.id === selectedSessionId ? result.session : item));
  };

  const createAttachmentPayload = (items: Array<ComposerAttachment | ChatAttachmentPayload>): ChatAttachmentPayload[] => items.map((item) => ({
    name: item.name,
    kind: item.kind,
    url: item.url,
    assetId: 'assetId' in item ? item.assetId : undefined,
    mimeType: item.mimeType,
  }));

  const queueChatSubmission = (submission: ChatSubmissionInput) => {
    setPendingAutoSubmission(submission);
    setQueuedMessageCount(1);
    setMessageDraft('');
    setAttachments([]);
    setStatusMessage('当前任务已进入执行阶段，下一条消息会在结果后发送');
    setErrorMessage('');
    return true;
  };

  const submitChatMessage = ({
    content: rawContent,
    sourceAttachments,
    requestMode,
    selectedModelOverride,
    reasoningLevelOverride,
    webSearchEnabledOverride,
    restoreDraft,
    restoreAttachments,
  }: ChatSubmissionInput) => {
    if (!selectedSessionId || (!rawContent.trim() && sourceAttachments.length === 0)) return false;
    if (runSubmissionMode === 'queue') {
      return queueChatSubmission({
        content: rawContent,
        sourceAttachments,
        requestMode,
        selectedModelOverride,
        reasoningLevelOverride,
        webSearchEnabledOverride,
        restoreDraft: rawContent,
        restoreAttachments: sourceAttachments
          .filter((item): item is ComposerAttachment => 'id' in item)
          .map((item) => item),
      });
    }
    if (runSubmissionMode === 'insert') {
      const interruptingSubmission: ChatSubmissionInput = {
        content: rawContent,
        sourceAttachments,
        requestMode,
        selectedModelOverride,
        reasoningLevelOverride,
        webSearchEnabledOverride,
        restoreDraft: rawContent,
        restoreAttachments: sourceAttachments
          .filter((item): item is ComposerAttachment => 'id' in item)
          .map((item) => item),
      };
      interruptingChatSubmissionRef.current = interruptingSubmission;
      setMessageDraft('');
      setAttachments([]);
      setStatusMessage('已收到新引导，正在停止当前回复');
      sendAbortControllerRef.current?.abort();
      return true;
    }
    const sendSessionId = selectedSessionId;
    const sendSelectedModel = selectedModelOverride || selectedModel;
    const sendReasoningLevel = reasoningLevelOverride ?? reasoningLevel;
    const sendWebSearchEnabled = webSearchEnabledOverride ?? webSearchEnabled;
    const content = rawContent.trim();
    const clientRequestId = `chatreq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const attachmentPayload = createAttachmentPayload(sourceAttachments);
    const optimisticUserMessage: AgentChatMessage = {
      id: `pending-user-${Date.now()}`,
      sessionId: sendSessionId,
      userId: currentUser?.id || '',
      role: 'user',
      content,
      attachments: attachmentPayload,
      createdAt: Date.now(),
      metadata: { pending: true, clientRequestId },
    };
    const optimisticAssistantMessage: AgentChatMessage = {
      id: `pending-assistant-${Date.now()}`,
      sessionId: sendSessionId,
      userId: currentUser?.id || '',
      role: 'assistant',
      content: requestMode === 'image_generation' ? '需求分析中' : '思考中',
      attachments: [],
      createdAt: Date.now() + 1,
      metadata: {
        pending: true,
        progress: true,
        requestMode,
        clientRequestId,
        progressStage: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
      },
    };
    const controller = new AbortController();
    sendAbortControllerRef.current = controller;
    pendingRestoreRef.current = {
      draft: restoreDraft,
      attachments: restoreAttachments,
      userMessageId: optimisticUserMessage.id,
      assistantMessageId: optimisticAssistantMessage.id,
    };
    setSendingMessage(true);
    setSendingRequestMode(requestMode);
    setPendingAssistantMessageId(optimisticAssistantMessage.id);
    setErrorMessage('');
    updateMessagesForSession(sendSessionId, (prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);
    setMessageDraft('');
    setAttachments([]);
    setLoading(true);
    void (async () => {
      try {
        const result = await sendChatMessage(sendSessionId, {
          content,
          attachments: attachmentPayload,
          selectedModel: sendSelectedModel,
          reasoningLevel: sendReasoningLevel,
          webSearchEnabled: sendWebSearchEnabled,
          requestMode,
          clientRequestId,
        }, {
          signal: controller.signal,
          stream: true,
          onProgress: (event: ChatProgressEvent) => {
            updateAssistantProgress(sendSessionId, optimisticAssistantMessage.id, event);
          },
        });
        updateMessagesForSession(sendSessionId, (prev) => [
          ...prev.filter((item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id),
          result.userMessage,
          result.assistantMessage,
        ]);
        await refreshChatSessions();
        if (selectedSessionIdRef.current === sendSessionId) {
          const messageResult = await fetchChatMessages(sendSessionId);
          applyMessagesForSession(sendSessionId, messageResult.messages);
        }
      } catch (error: any) {
        const pendingRestore = pendingRestoreRef.current;
        const interruptedSubmission = interruptingChatSubmissionRef.current;
        const abortedForInsert = Boolean(interruptedSubmission) && (error?.name === 'AbortError' || error?.message === 'INTERRUPTED' || String(error?.message || '').includes('aborted'));
        const shouldSyncCompletedResult = isUncertainSendFailure(error);
        if (shouldSyncCompletedResult) {
          setStatusMessage('后台仍在处理中，正在同步最新结果');
          updateMessagesForSession(sendSessionId, (prev) => prev.map((item) => (
            item.id === (pendingRestore?.assistantMessageId || optimisticAssistantMessage.id)
              ? {
                  ...item,
                  content: '后台仍在处理中，正在同步最新结果',
                  metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage: 'syncing', clientRequestId },
                }
              : item
          )));
          try {
            const synced = await syncCompletedMessageAfterTimeout(sendSessionId, clientRequestId);
            if (synced) {
              applyMessagesForSession(sendSessionId, synced.messages);
              await refreshChatSessions();
              setStatusMessage('已同步后台生成结果');
              return;
            }
          } catch {
            // ignore and fall through to restore draft
          }
        }
        updateMessagesForSession(sendSessionId, (prev) => prev.filter((item) => item.id !== (pendingRestore?.userMessageId || optimisticUserMessage.id) && item.id !== (pendingRestore?.assistantMessageId || optimisticAssistantMessage.id)));
        if (!abortedForInsert && pendingRestore && selectedSessionIdRef.current === sendSessionId) {
          setMessageDraft(pendingRestore.draft);
          setAttachments(pendingRestore.attachments);
        }
        if (error?.name === 'AbortError' || error?.message === 'INTERRUPTED' || String(error?.message || '').includes('aborted')) {
          setStatusMessage(abortedForInsert ? '正在按新输入重新回复' : '已停止等待本次回复');
        } else {
          setErrorMessage(error.message || '消息发送失败');
        }
      } finally {
        const nextSubmission = interruptingChatSubmissionRef.current;
        if (nextSubmission) {
          interruptingChatSubmissionRef.current = null;
          setPendingAutoSubmission(nextSubmission);
        }
        sendAbortControllerRef.current = null;
        pendingRestoreRef.current = null;
        setSendingMessage(false);
        setSendingRequestMode(null);
        setPendingAssistantMessageId('');
        setLoading(false);
      }
    })();
    return true;
  };

  const handleSendMessage = () => {
    void submitChatMessage({
      content: messageDraft,
      sourceAttachments: attachments,
      requestMode: imageModeEnabled ? 'image_generation' : 'chat',
      restoreDraft: messageDraft,
      restoreAttachments: attachments,
    });
  };

  useEffect(() => {
    if (!pendingAutoSubmission || sendingMessage || hasActivePendingRun) return;
    const nextSubmission = pendingAutoSubmission;
    setPendingAutoSubmission(null);
    setQueuedMessageCount(0);
    void submitChatMessage(nextSubmission);
  }, [pendingAutoSubmission, sendingMessage, hasActivePendingRun]);

  const handleCopyMessage = useCallback(async (message: AgentChatMessage) => {
    const copied = await copyTextToClipboard(getVisibleMessageText(message));
    if (copied) {
      setStatusMessage('已复制消息内容');
      setErrorMessage('');
      return;
    }
    setErrorMessage('复制失败，请手动选择消息内容复制');
  }, []);

  const handleRegenerateMessage = useCallback((message: AgentChatMessage) => {
    if (sendingMessage || message.role !== 'assistant') return;
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    const previousUserMessage = messages
      .slice(0, messageIndex >= 0 ? messageIndex : messages.length)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previousUserMessage) {
      setErrorMessage('找不到可重新生成的问题');
      return;
    }
    const regenerateRequest = resolveRegenerateRequest({
      assistantMessage: message,
      previousUserMessage,
    });
    const submitted = submitChatMessage({
      content: regenerateRequest.content,
      sourceAttachments: regenerateRequest.sourceAttachments,
      requestMode: regenerateRequest.requestMode === 'image_generation' ? 'image_generation' : 'chat',
      selectedModelOverride: regenerateRequest.selectedModel,
      reasoningLevelOverride: regenerateRequest.reasoningLevel,
      webSearchEnabledOverride: regenerateRequest.webSearchEnabled,
      restoreDraft: '',
      restoreAttachments: [],
    });
    if (!submitted) {
      setErrorMessage('当前会话暂时无法重新生成');
    }
  }, [messages, sendingMessage, submitChatMessage]);

  const renderShellMessageActions = useCallback((message: AgentChatMessage) => {
    if (message.role !== 'assistant' || message.metadata?.pending) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleCopyMessage(message)}
          className="agent-message-action-icon group relative inline-flex h-9 w-9 items-center justify-center rounded-full border text-[15px] transition hover:opacity-80"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          title="复制消息"
          aria-label="复制消息"
        >
          <LegacyFaIcon icon="fa-copy" />
          <MessageActionTooltip label="复制消息" />
        </button>
        <button
          type="button"
          onClick={() => handleRegenerateMessage(message)}
          disabled={sendingMessage}
          className="agent-message-action-icon group relative inline-flex h-9 w-9 items-center justify-center rounded-full border text-[15px] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          title="重新生成"
          aria-label="重新生成"
        >
          <LegacyFaIcon icon="fa-rotate-right" />
          <MessageActionTooltip label="重新生成" />
        </button>
      </div>
    );
  }, [handleCopyMessage, handleRegenerateMessage, sendingMessage]);

  /**
   * 批量发送调度：串行发送每批附件，等待每批模型回复后再发下一批。
   * 最后一批附加综合总结请求。
   * 整个过程中 sendingMessage 保持 true，用户可通过中断按钮终止。
   */
  const handleBatchSend = useCallback(async (
    batches: ComposerAttachment[][],
    meta: { totalFiles: number; skippedCount: number; skippedReasons: string[] },
  ) => {
    if (!selectedSessionId || batches.length === 0) return;

    const batchSessionId = selectedSessionId;
    const batchSelectedModel = selectedModel;
    const batchReasoningLevel = reasoningLevel;
    const batchWebSearchEnabled = webSearchEnabled;
    const controller = new AbortController();
    sendAbortControllerRef.current = controller;
    setSendingMessage(true);
    setErrorMessage('');

    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (controller.signal.aborted) break;

        const isLast = batchIndex === batches.length - 1;
        const batchAttachments = batches[batchIndex];
        const batchNum = batchIndex + 1;
        const totalBatches = batches.length;

        // 构建每批的提示文本
        let batchContent: string;
        if (totalBatches === 1) {
          // 只有一批，直接请求分析
          batchContent = `以下是上传的 ${meta.totalFiles} 个文件${meta.skippedCount > 0 ? `（另有 ${meta.skippedCount} 个文件因不支持或超大已跳过）` : ''}，请进行分析。`;
        } else if (isLast) {
          // 最后一批，附加综合总结请求
          batchContent = `【第 ${batchNum}/${totalBatches} 批，最后一批】以下是最后一批文件。请在分析完这批内容后，综合前面所有批次的内容，给出完整的总结与分析结论。`;
        } else {
          // 中间批次
          batchContent = `【第 ${batchNum}/${totalBatches} 批】以下是第 ${batchNum} 批文件（共 ${totalBatches} 批，每批最多 ${MAX_FILES_PER_BATCH} 个），请先分析这批内容，后续还有更多批次。`;
        }

        const attachmentPayload = batchAttachments.map((item) => ({
          name: item.name,
          kind: item.kind,
          url: item.url,
          mimeType: item.mimeType,
        }));

        const clientRequestId = `batchreq-${batchIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticUserMessage: AgentChatMessage = {
          id: `pending-user-batch-${batchIndex}-${Date.now()}`,
          sessionId: batchSessionId,
          userId: currentUser?.id || '',
          role: 'user',
          content: batchContent,
          attachments: attachmentPayload,
          createdAt: Date.now(),
          metadata: { pending: true, clientRequestId },
        };
        const optimisticAssistantMessage: AgentChatMessage = {
          id: `pending-assistant-batch-${batchIndex}-${Date.now()}`,
          sessionId: batchSessionId,
          userId: currentUser?.id || '',
          role: 'assistant',
          content: '思考中',
          attachments: [],
          createdAt: Date.now() + 1,
          metadata: { pending: true, progress: true, requestMode: 'chat', clientRequestId, progressStage: 'thinking' },
        };

        setPendingAssistantMessageId(optimisticAssistantMessage.id);
        updateMessagesForSession(batchSessionId, (prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);

        try {
          const result = await sendChatMessage(batchSessionId, {
            content: batchContent,
            attachments: attachmentPayload,
            selectedModel: batchSelectedModel,
            reasoningLevel: batchReasoningLevel,
            webSearchEnabled: batchWebSearchEnabled,
            requestMode: 'chat',
            clientRequestId,
          }, {
            signal: controller.signal,
            stream: true,
            onProgress: (event: ChatProgressEvent) => {
              updateAssistantProgress(batchSessionId, optimisticAssistantMessage.id, event);
            },
          });

          updateMessagesForSession(batchSessionId, (prev) => [
            ...prev.filter((item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id),
            result.userMessage,
            result.assistantMessage,
          ]);
        } catch (batchError: any) {
          // 移除乐观消息
          updateMessagesForSession(batchSessionId, (prev) => prev.filter(
            (item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id
          ));
          if (batchError?.name === 'AbortError' || batchError?.message === 'INTERRUPTED' || String(batchError?.message || '').includes('aborted')) {
            setStatusMessage(`批量分析已中断（已完成 ${batchIndex}/${totalBatches} 批）`);
          } else {
            setErrorMessage(`第 ${batchNum} 批发送失败：${batchError?.message || '未知错误'}`);
          }
          return; // 中止后续批次
        }
      }

      // 全部批次完成后刷新会话
      await refreshChatSessions();
      if (selectedSessionIdRef.current === batchSessionId) {
        const messageResult = await fetchChatMessages(batchSessionId);
        applyMessagesForSession(batchSessionId, messageResult.messages);
      }
    } finally {
      sendAbortControllerRef.current = null;
      setSendingMessage(false);
      setPendingAssistantMessageId('');
      setLoading(false);
    }
  }, [selectedSessionId, selectedModel, reasoningLevel, webSearchEnabled, currentUser]);

  const renderFactoryOverview = () => (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-[20px] p-4" style={{ background: 'var(--bg-surface)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>工厂控制台</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFactoryView('manager')}
              className="rounded-full px-3 py-2 text-[12px] font-semibold"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              知识库
            </button>
            <button
              type="button"
              onClick={() => setFactoryView('manager')}
              className="rounded-2xl px-3 py-2 text-[12px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              新建智能体
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            ['全部', factoryStats.total],
            ['已发布', factoryStats.published],
            ['草稿', factoryStats.draft],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[18px] p-3" style={{ background: 'var(--bg-elevated)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
              <p className="mt-1 text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <section className="min-h-0 flex-1 p-1">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>智能体队列</p>
          <button
            type="button"
            onClick={() => setFactoryView('manager')}
            className="rounded-full px-3 py-2 text-[12px] font-semibold"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            完整管理
          </button>
        </div>
        <div className="grid max-h-full gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
          {factoryAgents.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-8 text-center md:col-span-2 xl:col-span-3" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
              暂无智能体数据
            </div>
          ) : factoryAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setFactoryView('manager')}
              className="group rounded-3xl border p-4 text-left transition-all"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-[14px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  {agent.name.slice(0, 1)}
                </div>
                <span className="rounded-2xl px-2.5 py-1 text-[10px] font-medium" style={{ background: agent.status === 'published' ? 'rgba(16,185,129,0.12)' : 'var(--bg-elevated)', color: agent.status === 'published' ? '#10b981' : 'var(--text-tertiary)' }}>
                  {agent.status === 'published' ? '已发布' : agent.status === 'draft' ? '草稿' : '归档'}
                </span>
              </div>
              <p className="mt-3 truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
              <p className="mt-1 line-clamp-2 min-h-[36px] text-[12px] leading-5" style={{ color: 'var(--text-tertiary)' }}>{agent.description || '暂无说明'}</p>
              <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-disabled)' }}>{agent.department || '未分组'}</span>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>编辑 / 工作室</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  if (!canAccessAgentCenter) {
    return (
      <div className="h-full overflow-y-auto px-6 pb-6 pt-5" style={{ background: 'var(--bg-base)' }}>
        <div className="mx-auto max-w-4xl">
          <h2 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>智能体中心</h2>
          <p className="mt-3 text-[13px] leading-7" style={{ color: 'var(--text-secondary)' }}>当前账号没有智能体中心权限。</p>
        </div>
      </div>
    );
  }

  const lockChatPageScroll = workspaceMode === 'plaza' && workspacePage === 'chat';
  const lockWorkspaceScroll = lockChatPageScroll;

  return (
    <div className={`agent-center-shell-scope workspace-shell h-full min-h-0 ${lockWorkspaceScroll ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ background: 'var(--bg-base)' }}>
      <AgentCenterShellStyles />
      <div className="workspace-content flex h-full min-h-0 w-full flex-col">
        <header className="mb-3 flex-none border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{workspaceMode === 'factory' ? moduleCopy.factory.title : moduleCopy.plaza.title}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canManage ? (
                <div className="inline-flex rounded-full p-1" style={{ background: 'var(--bg-elevated)' }}>
                  <button
                    type="button"
                    onClick={() => setWorkspaceMode('plaza')}
                    className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all"
                    style={{ background: workspaceMode === 'plaza' ? 'var(--bg-surface)' : 'transparent', color: workspaceMode === 'plaza' ? 'var(--accent)' : 'var(--text-secondary)', boxShadow: workspaceMode === 'plaza' ? 'var(--shadow-card)' : 'none' }}
                  >
                    智能体广场
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceMode('factory')}
                    className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all"
                    style={{ background: workspaceMode === 'factory' ? 'var(--bg-surface)' : 'transparent', color: workspaceMode === 'factory' ? 'var(--accent)' : 'var(--text-secondary)', boxShadow: workspaceMode === 'factory' ? 'var(--shadow-card)' : 'none' }}
                  >
                    智能体工厂
                  </button>
                </div>
              ) : (
                <div className="rounded-full px-3 py-1.5 text-[12px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  智能体广场
                </div>
              )}
            </div>
          </div>
        </header>

        {errorMessage ? <div className="mb-2 rounded-2xl border px-3 py-2 text-[12px] font-medium" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>{errorMessage}</div> : null}
        {statusMessage ? <div className="mb-2 rounded-2xl border px-3 py-2 text-[12px] font-medium" style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.18)', color: '#10b981' }}>{statusMessage}</div> : null}
        <div className={`min-h-0 flex-1 ${lockWorkspaceScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {canManage && workspaceMode === 'factory' ? (
            factoryView === 'overview' ? (
              renderFactoryOverview()
            ) : (
              <div className="h-full min-h-0">
                <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>制作细节</span>
                  <button
                    type="button"
                    onClick={() => setFactoryView('overview')}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    返回工厂总览
                  </button>
                </div>
                <AgentCenterManager
                  onStatusMessage={setStatusMessage}
                  onErrorMessage={setErrorMessage}
                  onLoadingChange={setLoading}
                  onAgentCatalogChanged={() => {
                    void refreshChatCatalog();
                    void fetchAgentSummaries().then((result) => setFactoryAgents(result.agents || [])).catch(() => {});
                  }}
                />
              </div>
            )
          ) : (
            <AgentCenterChatWorkspace
              currentUser={currentUser}
              chatAgents={chatAgents}
              recentAgents={recentAgents}
              sessions={sessions}
              workspacePage={workspacePage}
              selectedAgentId={selectedAgent?.id || selectedAgentId}
              selectedSessionId={selectedSessionId}
              messages={messages}
              messageDraft={messageDraft}
              chatModels={availableChatModels}
              selectedModel={selectedModel}
              reasoningLevel={reasoningLevel}
              webSearchEnabled={webSearchEnabled}
              attachments={attachments}
              imageModeEnabled={imageModeEnabled}
              sendingMessage={sendingMessage || hasActivePendingRun}
              sessionsCollapsed={sessionsCollapsed}
              onToggleSessionsCollapsed={() => setSessionsCollapsed((value) => !value)}
              onPreviewAgent={(agentId) => {
                setSelectedAgentId(agentId);
              }}
              onEnterAgent={handleEnterAgent}
              onBackToPlaza={() => {
                setWorkspacePage('plaza');
                setActiveSessionId('');
                setMessages([]);
              }}
              onCreateSession={handleCreateSession}
              onSelectSession={(sessionId) => {
                const matched = sessions.find((item) => item.id === sessionId);
                if (matched) setSelectedAgentId(matched.agentId);
                setWorkspacePage('chat');
                setActiveSessionId(sessionId);
              }}
              onDeleteSession={handleDeleteSession}
              onDeleteAgentHistory={handleDeleteAgentHistory}
              onMessageDraftChange={setMessageDraft}
              onSelectedModelChange={(value) => {
                const nextReasoningLevel = resolveReasoningLevelForModel(value, null);
                setSelectedModel(value);
                setReasoningLevel(nextReasoningLevel);
                void syncSessionOptions({ selectedModel: value, reasoningLevel: nextReasoningLevel });
              }}
              onReasoningLevelChange={(value) => {
                setReasoningLevel(value);
                void syncSessionOptions({ reasoningLevel: value });
              }}
              onWebSearchToggle={() => {
                const next = !webSearchEnabled;
                setWebSearchEnabled(next);
                void syncSessionOptions({ webSearchEnabled: next });
              }}
              onAddAttachments={(next) => {
                const maxInputImages = Number(selectedAgent?.imageMaxInputCount || next.length || 1);
                setAttachments((prev) => {
                  const merged = [...prev, ...next];
                  const imageItems = merged.filter((item) => item.kind === 'image').slice(0, maxInputImages);
                  const fileItems = merged.filter((item) => item.kind !== 'image');
                  return [...imageItems, ...fileItems];
                });
              }}
              onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
              onImageModeToggle={() => {
                const next = !imageModeEnabled;
                setImageModeEnabled(next);
                setAttachments((prev) => next ? prev.filter((item) => item.kind === 'image') : prev);
                void syncSessionOptions({ lastImageMode: next });
              }}
              onSendMessage={handleSendMessage}
              onInterruptSend={undefined}
              runSubmissionMode={runSubmissionMode}
              queuedMessageCount={queuedMessageCount}
              onHandoff={onHandoff}
              onBatchSend={handleBatchSend}
              renderMessageActions={renderShellMessageActions}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentCenterModule;
