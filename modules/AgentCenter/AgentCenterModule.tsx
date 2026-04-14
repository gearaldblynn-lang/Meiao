import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../types';
import {
  createChatSession,
  deleteChatSession,
  deleteUserAgentHistory,
  fetchChatAgents,
  fetchChatMessages,
  fetchChatSessions,
  fetchSystemConfig,
  sendChatMessage,
  type ChatProgressEvent,
  updateChatSession,
} from '../../services/internalApi';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentCenterManager from './AgentCenterManager';
import AgentCenterChatWorkspace from './AgentCenterChatWorkspace';
import { ComposerAttachment } from './ChatComposer';
import { resolveActiveAgentId } from './agentCenterUtils.mjs';
import { resolveSessionReasoningLevel } from './chatReasoningDefaults.mjs';
import { MAX_FILES_PER_BATCH } from './folderZipUpload';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onHandoff?: (target: ModuleInterfaceId, payload: Record<string, unknown>) => void;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const AGENT_CENTER_UI_STATE_KEY = 'MEIAO_AGENT_CENTER_UI_STATE';

const readAgentCenterUiState = () => {
  try {
    const raw = sessionStorage.getItem(AGENT_CENTER_UI_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

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
  const sendAbortControllerRef = useRef<AbortController | null>(null);
  const pendingRestoreRef = useRef<{ draft: string; attachments: ComposerAttachment[]; userMessageId: string; assistantMessageId: string } | null>(null);
  const previousWorkspaceModeRef = useRef(workspaceMode);
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
    if (previousWorkspaceModeRef.current === workspaceMode) return;
    previousWorkspaceModeRef.current = workspaceMode;
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
        const assistantMessage = result.messages.find((item) => item.role === 'assistant' && item.metadata?.clientRequestId === clientRequestId);
        const fallbackAssistantMessage = userMessage
          ? result.messages
              .filter((item) => item.role === 'assistant' && !item.metadata?.pending && Number(item.createdAt || 0) >= Number(userMessage.createdAt || 0))
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

  const handleCreateSession = (agentId: string) => runAction(async () => {
    const result = await createChatSession(agentId);
    setSelectedAgentId(agentId);
    setWorkspacePage('chat');
    await loadChat(agentId, result.session.id);
    if (result.openingRemarks?.trim()) {
      setMessages([{
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
      setMessages([{
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
    const clientRequestId = `chatreq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      metadata: { pending: true, clientRequestId },
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
        clientRequestId,
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
          clientRequestId,
        }, {
          signal: controller.signal,
          onProgress: (event: ChatProgressEvent) => {
            setMessages((prev) => prev.map((item) => {
              if (item.id !== optimisticAssistantMessage.id) return item;
              let content: string;
              let progressStage: string;
              if (event.stage === 'thinking') {
                content = event.round <= 1 ? '正在思考...' : `第 ${event.round} 轮深度思考中...`;
                progressStage = 'thinking';
              } else {
                const docs = (event.docTitles || []).slice(0, 3);
                if (event.round === 0) {
                  content = docs.length > 0
                    ? `已读取：${docs.join('、')}${(event.docTitles || []).length > 3 ? ` 等 ${(event.docTitles || []).length} 份资料` : ''}`
                    : `已检索到 ${event.chunkCount || 0} 条相关内容`;
                } else {
                  const queryStr = (event.queries || []).slice(0, 2).join('、');
                  content = docs.length > 0
                    ? `检索「${queryStr}」→ ${docs.join('、')}`
                    : `检索「${queryStr}」未找到新内容`;
                }
                progressStage = 'replying';
              }
              return { ...item, content, metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage } };
            }));
          },
        });
        setMessages((prev) => [
          ...prev.filter((item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id),
          result.userMessage,
          result.assistantMessage,
        ]);
        await loadChat(selectedAgentId, selectedSessionId);
      } catch (error: any) {
        const pendingRestore = pendingRestoreRef.current;
        const shouldSyncCompletedResult = requestMode === 'image_generation'
          && (error?.code === 'timeout' || error?.code === 'network_error');
        if (shouldSyncCompletedResult) {
          setStatusMessage('后台仍在处理中，正在同步最新结果');
          setMessages((prev) => prev.map((item) => (
            item.id === (pendingRestore?.assistantMessageId || optimisticAssistantMessage.id)
              ? {
                  ...item,
                  content: '后台仍在处理中，正在同步最新结果',
                  metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage: 'syncing', clientRequestId },
                }
              : item
          )));
          try {
            const synced = await syncCompletedMessageAfterTimeout(selectedSessionId, clientRequestId);
            if (synced) {
              setMessages(synced.messages);
              setStatusMessage('已同步后台生成结果');
              return;
            }
          } catch {
            // ignore and fall through to restore draft
          }
        }
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
          sessionId: selectedSessionId,
          userId: currentUser?.id || '',
          role: 'user',
          content: batchContent,
          attachments: attachmentPayload,
          createdAt: Date.now(),
          metadata: { pending: true, clientRequestId },
        };
        const optimisticAssistantMessage: AgentChatMessage = {
          id: `pending-assistant-batch-${batchIndex}-${Date.now()}`,
          sessionId: selectedSessionId,
          userId: currentUser?.id || '',
          role: 'assistant',
          content: '思考中',
          attachments: [],
          createdAt: Date.now() + 1,
          metadata: { pending: true, progress: true, requestMode: 'chat', clientRequestId, progressStage: 'thinking' },
        };

        setPendingAssistantMessageId(optimisticAssistantMessage.id);
        setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);

        try {
          const result = await sendChatMessage(selectedSessionId, {
            content: batchContent,
            attachments: attachmentPayload,
            selectedModel,
            reasoningLevel,
            webSearchEnabled,
            requestMode: 'chat',
            clientRequestId,
          }, {
            signal: controller.signal,
            onProgress: (event: ChatProgressEvent) => {
              setMessages((prev) => prev.map((item) => {
                if (item.id !== optimisticAssistantMessage.id) return item;
                let content: string;
                let progressStage: string;
                if (event.stage === 'thinking') {
                  content = event.round <= 1 ? '正在思考...' : `第 ${event.round} 轮深度思考中...`;
                  progressStage = 'thinking';
                } else {
                  const docs = (event.docTitles || []).slice(0, 3);
                  content = docs.length > 0
                    ? `已读取：${docs.join('、')}`
                    : `已检索到 ${event.chunkCount || 0} 条相关内容`;
                  progressStage = 'replying';
                }
                return { ...item, content, metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage } };
              }));
            },
          });

          setMessages((prev) => [
            ...prev.filter((item) => item.id !== optimisticUserMessage.id && item.id !== optimisticAssistantMessage.id),
            result.userMessage,
            result.assistantMessage,
          ]);
        } catch (batchError: any) {
          // 移除乐观消息
          setMessages((prev) => prev.filter(
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
      await loadChat(selectedAgentId, selectedSessionId);
    } finally {
      sendAbortControllerRef.current = null;
      setSendingMessage(false);
      setPendingAssistantMessageId('');
      setLoading(false);
    }
  }, [selectedSessionId, selectedModel, reasoningLevel, webSearchEnabled, currentUser, selectedAgentId]);

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
        <header className="mb-3 flex-none rounded-[28px] border border-slate-200/80 bg-white/88 px-4 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {canManage ? (
              <div className="inline-flex rounded-[18px] border border-slate-200/80 bg-white/86 p-1">
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('factory')}
                  className={`rounded-[14px] px-3.5 py-2 text-[13px] font-black transition ${
                    workspaceMode === 'factory' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  智能体工厂
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('plaza')}
                  className={`rounded-[14px] px-3.5 py-2 text-[13px] font-black transition ${
                    workspaceMode === 'plaza' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  智能体广场
                </button>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-[18px] border border-slate-200/80 bg-white/88 px-3 py-2 text-[12px] font-semibold text-slate-500">
                <i className="fas fa-robot text-[11px] text-slate-400" />
                <span>内部智能体工作台</span>
              </div>
            )}

            {canManage ? (
              <div className="inline-flex items-center gap-2 rounded-[18px] border border-slate-200/80 bg-white/88 px-3 py-2 text-[12px] font-semibold text-slate-500">
                <span>资源</span>
                <span className="text-slate-300">·</span>
                <span>智能体</span>
                <span className="text-slate-300">/</span>
                <span>知识库</span>
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
              onInterruptSend={handleInterruptSend}
              onHandoff={onHandoff}
              onBatchSend={handleBatchSend}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentCenterModule;
