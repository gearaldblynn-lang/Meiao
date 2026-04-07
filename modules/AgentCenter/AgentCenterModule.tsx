import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, SystemPublicConfig } from '../../types';
import {
  createChatSession,
  deleteChatSession,
  deleteUserAgentHistory,
  fetchChatAgents,
  fetchChatMessages,
  fetchChatSessions,
  fetchSystemConfig,
  sendChatMessage,
  updateChatSession,
} from '../../services/internalApi';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentCenterManager from './AgentCenterManager';
import AgentCenterChatWorkspace from './AgentCenterChatWorkspace';
import { ComposerAttachment } from './ChatComposer';
import { resolveActiveAgentId } from './agentCenterUtils.mjs';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
}

const AgentCenterModule: React.FC<Props> = ({ currentUser = null, internalMode = false }) => {
  const [workspaceMode, setWorkspaceMode] = useState<'factory' | 'plaza'>('plaza');
  const [chatAgents, setChatAgents] = useState<AgentSummary[]>([]);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
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
  const [workspacePage, setWorkspacePage] = useState<'plaza' | 'chat'>('plaza');
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const sendAbortControllerRef = useRef<AbortController | null>(null);
  const pendingRestoreRef = useRef<{ draft: string; attachments: ComposerAttachment[]; userMessageId: string; assistantMessageId: string } | null>(null);
  const canManage = Boolean(internalMode && currentUser?.role === 'admin');
  const canAccessAgentCenter = Boolean(internalMode && currentUser);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
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
    const allowed = new Set((selectedAgent?.allowedChatModels || []).filter(Boolean));
    if (allowed.size === 0) return chatModels;
    const filtered = chatModels.filter((item) => allowed.has(item.id));
    return filtered.length > 0 ? filtered : chatModels;
  }, [chatModels, selectedAgent?.allowedChatModels]);

  const refreshChatCatalog = async () => {
    const agentResult = await fetchChatAgents();
    setChatAgents(agentResult.agents);
  };

  const loadChat = async (preferredAgentId = '', preferredSessionId = '') => {
    const [agentResult, sessionResult, systemConfigResult] = await Promise.all([
      fetchChatAgents(),
      fetchChatSessions(),
      fetchSystemConfig(),
    ]);
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
    setSelectedSessionId(preferredSession?.id || '');
    if (preferredSession?.id) {
      const messageResult = await fetchChatMessages(preferredSession.id);
      setMessages(messageResult.messages);
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
    if (!canAccessAgentCenter || workspaceMode !== 'plaza') return;
    void refreshChatCatalog().catch(() => {});
  }, [canAccessAgentCenter, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== 'plaza') return;
    setWorkspacePage('plaza');
    setSelectedSessionId('');
    setMessages([]);
    setImageModeEnabled(false);
  }, [workspaceMode]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    fetchChatMessages(selectedSessionId)
      .then((result) => setMessages(result.messages))
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
      setMessages((prev) => prev.map((item) => (
        item.id === pendingAssistantMessageId
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
      setReasoningLevel(null);
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
    setReasoningLevel(selectedSession.reasoningLevel || null);
    setWebSearchEnabled(Boolean(selectedSession.webSearchEnabled));
    setAttachments([]);
    setImageModeEnabled(Boolean(selectedSession.lastImageMode));
  }, [selectedSession?.id, selectedSession?.selectedModel, selectedSession?.reasoningLevel, selectedSession?.webSearchEnabled, availableChatModels, selectedAgent?.defaultChatModel]);

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

  const handleCreateSession = (agentId: string) => runAction(async () => {
    const result = await createChatSession(agentId);
    setSelectedAgentId(agentId);
    setWorkspacePage('chat');
    await loadChat(agentId, result.session.id);
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
  });

  const handleDeleteSession = (sessionId: string) => runAction(async () => {
    await deleteChatSession(sessionId);
    const fallbackSession = sessions.find((item) => item.id !== sessionId && item.agentId === selectedAgentId) || sessions.find((item) => item.id !== sessionId) || null;
    await loadChat(selectedAgentId, fallbackSession?.id || '');
  });

  const handleDeleteAgentHistory = (agentId: string) => runAction(async () => {
    await deleteUserAgentHistory(agentId);
    if (selectedAgentId === agentId) {
      setSelectedSessionId('');
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

  const handleSendMessage = () => {
    if (sendingMessage || !selectedSessionId || (!messageDraft.trim() && attachments.length === 0)) return;
    const content = messageDraft.trim();
    const requestMode = imageModeEnabled ? 'image_generation' : 'chat';
    const attachmentPayload = attachments.map((item) => ({
      name: item.name,
      kind: item.kind,
      url: item.url,
      mimeType: item.mimeType,
    }));
    const optimisticUserMessage: AgentChatMessage = {
      id: `pending-user-${Date.now()}`,
      sessionId: selectedSessionId,
      userId: currentUser?.id || '',
      role: 'user',
      content,
      attachments: attachmentPayload,
      createdAt: Date.now(),
      metadata: { pending: true },
    };
    const optimisticAssistantMessage: AgentChatMessage = {
      id: `pending-assistant-${Date.now()}`,
      sessionId: selectedSessionId,
      userId: currentUser?.id || '',
      role: 'assistant',
      content: requestMode === 'image_generation' ? '需求分析中' : '思考中',
      attachments: [],
      createdAt: Date.now() + 1,
      metadata: {
        pending: true,
        progress: true,
        requestMode,
        progressStage: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
      },
    };
    const previousDraft = messageDraft;
    const previousAttachments = attachments;
    const controller = new AbortController();
    sendAbortControllerRef.current = controller;
    pendingRestoreRef.current = {
      draft: previousDraft,
      attachments: previousAttachments,
      userMessageId: optimisticUserMessage.id,
      assistantMessageId: optimisticAssistantMessage.id,
    };
    setSendingMessage(true);
    setSendingRequestMode(requestMode);
    setPendingAssistantMessageId(optimisticAssistantMessage.id);
    setErrorMessage('');
    setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);
    setMessageDraft('');
    setAttachments([]);
    setLoading(true);
    void (async () => {
      try {
        const result = await sendChatMessage(selectedSessionId, {
          content,
          attachments: attachmentPayload,
          selectedModel,
          reasoningLevel,
          webSearchEnabled,
          requestMode,
        }, {
          signal: controller.signal,
        });
        setMessages((prev) => [
          ...prev.filter((item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id),
          result.userMessage,
          result.assistantMessage,
        ]);
        await loadChat(selectedAgentId, selectedSessionId);
      } catch (error: any) {
        const pendingRestore = pendingRestoreRef.current;
        setMessages((prev) => prev.filter((item) => item.id !== (pendingRestore?.userMessageId || optimisticUserMessage.id) && item.id !== (pendingRestore?.assistantMessageId || optimisticAssistantMessage.id)));
        if (pendingRestore) {
          setMessageDraft(pendingRestore.draft);
          setAttachments(pendingRestore.attachments);
        } else {
          setMessageDraft(previousDraft);
          setAttachments(previousAttachments);
        }
        if (error?.name === 'AbortError' || error?.message === 'INTERRUPTED' || String(error?.message || '').includes('aborted')) {
          setStatusMessage('已中断本次发送');
        } else {
          setErrorMessage(error.message || '消息发送失败');
        }
      } finally {
        sendAbortControllerRef.current = null;
        pendingRestoreRef.current = null;
        setSendingMessage(false);
        setSendingRequestMode(null);
        setPendingAssistantMessageId('');
        setLoading(false);
      }
    })();
  };

  const handleInterruptSend = () => {
    if (!sendAbortControllerRef.current) return;
    sendAbortControllerRef.current.abort();
  };

  if (!canAccessAgentCenter) {
    return (
      <div className="h-full overflow-y-auto px-6 pb-6 pt-5">
        <div className="mx-auto max-w-4xl">
          <WorkspaceShellCard className="bg-slate-50/90 px-8 py-7">
            <h2 className="text-2xl font-black text-slate-900">智能体中心</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-500">当前账号没有智能体中心权限。</p>
          </WorkspaceShellCard>
        </div>
      </div>
    );
  }

  const lockChatPageScroll = workspaceMode === 'plaza' && workspacePage === 'chat';
  const lockWorkspaceScroll = lockChatPageScroll;

  return (
    <div className={`h-full min-h-0 px-4 pb-4 pt-4 lg:px-5 ${lockWorkspaceScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <header className="mb-4 flex-none rounded-[32px] border border-slate-200/80 bg-white/90 px-8 py-7 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black text-slate-900">智能体中心</h2>
              <p className="mt-3 text-sm font-bold text-slate-500">
                当前登录：{currentUser?.displayName || currentUser?.username || '未登录'}{currentUser?.isSuperAdmin ? ' · 总管理员' : currentUser?.role === 'admin' ? ' · 部门管理员' : ' · 内部成员'}
              </p>
            </div>
            {canManage ? (
              <div className="inline-flex rounded-[20px] border border-slate-200/80 bg-white/86 p-1">
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('factory')}
                  className={`rounded-[16px] px-4 py-2.5 text-sm font-black transition ${
                    workspaceMode === 'factory' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  智能体工厂
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('plaza')}
                  className={`rounded-[16px] px-4 py-2.5 text-sm font-black transition ${
                    workspaceMode === 'plaza' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  智能体广场
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {errorMessage ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{errorMessage}</div> : null}
        {statusMessage ? <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{statusMessage}</div> : null}
        <div className={`min-h-0 flex-1 ${lockWorkspaceScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {canManage && workspaceMode === 'factory' ? (
            <AgentCenterManager
              onStatusMessage={setStatusMessage}
              onErrorMessage={setErrorMessage}
              onLoadingChange={setLoading}
              onAgentCatalogChanged={() => {
                void refreshChatCatalog();
              }}
            />
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
              sendingMessage={sendingMessage}
              sessionsCollapsed={sessionsCollapsed}
              onToggleSessionsCollapsed={() => setSessionsCollapsed((value) => !value)}
              onPreviewAgent={(agentId) => {
                setSelectedAgentId(agentId);
              }}
              onEnterAgent={handleEnterAgent}
              onBackToPlaza={() => {
                setWorkspacePage('plaza');
                setSelectedSessionId('');
                setMessages([]);
              }}
              onCreateSession={handleCreateSession}
              onSelectSession={(sessionId) => {
                const matched = sessions.find((item) => item.id === sessionId);
                if (matched) setSelectedAgentId(matched.agentId);
                setWorkspacePage('chat');
                setSelectedSessionId(sessionId);
              }}
              onDeleteSession={handleDeleteSession}
              onDeleteAgentHistory={handleDeleteAgentHistory}
              onMessageDraftChange={setMessageDraft}
              onSelectedModelChange={(value) => {
                setSelectedModel(value);
                void syncSessionOptions({ selectedModel: value });
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
              onInterruptSend={handleInterruptSend}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentCenterModule;
