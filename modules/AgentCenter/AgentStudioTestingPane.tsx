import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AgentVersion, SystemPublicConfig } from '../../types';
import { createStudioTestSession, deleteChatSession, sendChatMessage, type ChatProgressEvent, updateChatSession } from '../../services/internalApi';
import ChatConversationPane from './ChatConversationPane';
import { ComposerAttachment } from './ChatComposer';
import { MAX_FILES_PER_BATCH } from './folderZipUpload';
import { resolveSessionReasoningLevel } from './chatReasoningDefaults.mjs';

interface Props {
  agent: AgentSummary;
  draftVersion: AgentVersion;
  availableChatModels: SystemPublicConfig['agentModels']['chat'];
  onCorrection: (question: string, answer: string) => void;
  onStatusMessage: (msg: string) => void;
  onErrorMessage: (msg: string) => void;
}

const glassPanel = 'rounded-[30px] border border-white/70 bg-white/72 shadow-[0_25px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl';

const AgentStudioTestingPane: React.FC<Props> = ({
  agent, draftVersion, availableChatModels, onCorrection, onStatusMessage, onErrorMessage,
}) => {
  const [session, setSession] = useState<AgentChatSession | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [imageModeEnabled, setImageModeEnabled] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 'good' | 'bad'>>({});
  const [loading, setLoading] = useState(true);
  const latestSessionIdRef = useRef<string | null>(null);
  const sendAbortControllerRef = useRef<AbortController | null>(null);
  const pendingRestoreRef = useRef<{ draft: string; attachments: ComposerAttachment[]; userMessageId: string; assistantMessageId: string } | null>(null);

  const imageModeAvailable = Boolean(draftVersion.modelPolicy?.imageGenerationEnabled && draftVersion.modelPolicy?.multimodalModel);
  const imageMaxInputCount = Number(agent.imageMaxInputCount || 1);
  const selectableChatModels = useMemo(() => {
    const allowed = new Set((draftVersion.allowedChatModels || []).filter(Boolean));
    const source = Array.isArray(availableChatModels) ? availableChatModels : [];
    if (!allowed.size) return source;
    const filtered = source.filter((item) => allowed.has(item.id));
    return filtered.length ? filtered : source;
  }, [availableChatModels, draftVersion.allowedChatModels]);

  const resolveReasoningLevelForModel = (modelId: string, requestedReasoningLevel: string | null = null) => {
    const capability = selectableChatModels.find((item) => item.id === modelId);
    return capability?.supportsReasoningLevel
      ? resolveSessionReasoningLevel({
          reasoningLevels: capability.reasoningLevels || [],
          requestedReasoningLevel,
        })
      : null;
  };

  const cleanupSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) return;
    await deleteChatSession(sessionId).catch(() => null);
    if (latestSessionIdRef.current === sessionId) {
      latestSessionIdRef.current = null;
      setSession(null);
    }
  }, []);

  const initSession = useCallback(async () => {
    setLoading(true);
    try {
      await cleanupSession(latestSessionIdRef.current);
      const result = await createStudioTestSession(agent.id, draftVersion.id);
      latestSessionIdRef.current = result.session.id;
      setSession(result.session);
      setMessages([]);
      setFeedback({});
      setDraft('');
      setAttachments([]);
      const nextModel = result.session.selectedModel || draftVersion.defaultChatModel || selectableChatModels[0]?.id || '';
      setSelectedModel(nextModel);
      setReasoningLevel(resolveReasoningLevelForModel(nextModel, result.session.reasoningLevel || null));
      setWebSearchEnabled(Boolean(result.session.webSearchEnabled));
      setImageModeEnabled(Boolean(result.session.lastImageMode));
    } catch (err: any) {
      onErrorMessage(err.message || '创建测试会话失败');
    } finally {
      setLoading(false);
    }
  }, [agent.id, cleanupSession, draftVersion.defaultChatModel, draftVersion.id, onErrorMessage, selectableChatModels]);

  useEffect(() => { void initSession(); }, [initSession]);

  useEffect(() => {
    return () => {
      const sessionId = latestSessionIdRef.current;
      latestSessionIdRef.current = null;
      setSession(null);
      if (sessionId) {
        void deleteChatSession(sessionId).catch(() => null);
      }
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const nextModel = session.selectedModel || draftVersion.defaultChatModel || selectableChatModels[0]?.id || '';
    setSelectedModel(nextModel);
    setReasoningLevel(resolveReasoningLevelForModel(nextModel, session.reasoningLevel || null));
    setWebSearchEnabled(Boolean(session.webSearchEnabled));
    setImageModeEnabled(Boolean(session.lastImageMode));
  }, [draftVersion.defaultChatModel, selectableChatModels, session]);

  const syncSessionOptions = async (payload: Partial<Pick<AgentChatSession, 'selectedModel' | 'reasoningLevel' | 'webSearchEnabled' | 'lastImageMode'>>) => {
    if (!session?.id) return;
    const result = await updateChatSession(session.id, payload);
    setSession(result.session);
  };

  const handleReset = async () => {
    if (session) {
      await cleanupSession(session.id);
    }
    await initSession();
    onStatusMessage('测试对话已重置');
  };

  const handleSend = () => {
    if (sending || !session?.id || (!draft.trim() && attachments.length === 0)) return;
    const content = draft.trim();
    const requestMode = imageModeEnabled ? 'image_generation' : 'chat';
    const clientRequestId = `studio-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const attachmentPayload = attachments.map((item) => ({
      name: item.name,
      kind: item.kind,
      url: item.url,
      mimeType: item.mimeType,
    }));
    const optimisticUserMessage: AgentChatMessage = {
      id: `pending-user-${Date.now()}`,
      sessionId: session.id,
      userId: '',
      role: 'user',
      content,
      attachments: attachmentPayload,
      createdAt: Date.now(),
      metadata: { pending: true, clientRequestId },
    };
    const optimisticAssistantMessage: AgentChatMessage = {
      id: `pending-assistant-${Date.now()}`,
      sessionId: session.id,
      userId: '',
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
    const previousDraft = draft;
    const previousAttachments = attachments;
    const controller = new AbortController();
    sendAbortControllerRef.current = controller;
    pendingRestoreRef.current = {
      draft: previousDraft,
      attachments: previousAttachments,
      userMessageId: optimisticUserMessage.id,
      assistantMessageId: optimisticAssistantMessage.id,
    };
    setSending(true);
    setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);
    setDraft('');
    setAttachments([]);
    void (async () => {
      try {
        const result = await sendChatMessage(session.id, {
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
        setSession((prev) => prev ? {
          ...prev,
          selectedModel,
          reasoningLevel,
          webSearchEnabled: requestMode === 'image_generation' ? false : webSearchEnabled,
          lastImageMode: requestMode === 'image_generation',
          updatedAt: Date.now(),
        } : prev);
      } catch (error: any) {
        const pendingRestore = pendingRestoreRef.current;
        setMessages((prev) => prev.filter((item) => item.id !== (pendingRestore?.userMessageId || optimisticUserMessage.id) && item.id !== (pendingRestore?.assistantMessageId || optimisticAssistantMessage.id)));
        if (pendingRestore) {
          setDraft(pendingRestore.draft);
          setAttachments(pendingRestore.attachments);
        } else {
          setDraft(previousDraft);
          setAttachments(previousAttachments);
        }
        if (error?.name === 'AbortError' || error?.message === 'INTERRUPTED' || String(error?.message || '').includes('aborted')) {
          onStatusMessage('已中断本次发送');
        } else {
          onErrorMessage(error.message || '消息发送失败');
        }
      } finally {
        sendAbortControllerRef.current = null;
        pendingRestoreRef.current = null;
        setSending(false);
      }
    })();
  };

  const handleInterruptSend = () => {
    if (!sendAbortControllerRef.current) return;
    sendAbortControllerRef.current.abort();
  };

  const handleBatchSend = useCallback(async (
    batches: ComposerAttachment[][],
    meta: { totalFiles: number; skippedCount: number; skippedReasons: string[] },
  ) => {
    if (!session?.id || batches.length === 0) return;
    const sessionId = session.id;
    console.log('[BatchSend] start, sessionId:', sessionId, 'batches:', batches.length, 'first batch size:', batches[0]?.length, 'first attachment:', batches[0]?.[0]);
    const controller = new AbortController();
    sendAbortControllerRef.current = controller;
    setSending(true);

    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (controller.signal.aborted) break;
        const isLast = batchIndex === batches.length - 1;
        const batchNum = batchIndex + 1;
        const totalBatches = batches.length;
        let batchContent: string;
        if (totalBatches === 1) {
          batchContent = `以下是上传的 ${meta.totalFiles} 个文件${meta.skippedCount > 0 ? `（另有 ${meta.skippedCount} 个文件因不支持或超大已跳过）` : ''}，请进行分析。`;
        } else if (isLast) {
          batchContent = `【第 ${batchNum}/${totalBatches} 批，最后一批】以下是最后一批文件。请在分析完这批内容后，综合前面所有批次的内容，给出完整的总结与分析结论。`;
        } else {
          batchContent = `【第 ${batchNum}/${totalBatches} 批】以下是第 ${batchNum} 批文件（共 ${totalBatches} 批，每批最多 ${MAX_FILES_PER_BATCH} 个），请先分析这批内容，后续还有更多批次。`;
        }
        const attachmentPayload = batches[batchIndex].map((item) => ({
          name: item.name, kind: item.kind, url: item.url, mimeType: item.mimeType,
        }));
        const clientRequestId = `studio-test-batch-${batchIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticUser: AgentChatMessage = {
          id: `pending-user-batch-${batchIndex}-${Date.now()}`,
          sessionId, userId: '', role: 'user',
          content: batchContent, attachments: attachmentPayload,
          createdAt: Date.now(), metadata: { pending: true, clientRequestId },
        };
        const optimisticAssistant: AgentChatMessage = {
          id: `pending-assistant-batch-${batchIndex}-${Date.now()}`,
          sessionId, userId: '', role: 'assistant',
          content: '思考中', attachments: [],
          createdAt: Date.now() + 1,
          metadata: { pending: true, progress: true, requestMode: 'chat', clientRequestId, progressStage: 'thinking' },
        };
        setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
        try {
          const result = await sendChatMessage(sessionId, {
            content: batchContent, attachments: attachmentPayload,
            selectedModel, reasoningLevel, webSearchEnabled,
            requestMode: 'chat', clientRequestId,
          }, {
            signal: controller.signal,
            onProgress: (event: ChatProgressEvent) => {
              setMessages((prev) => prev.map((item) => {
                if (item.id !== optimisticAssistant.id) return item;
                let content: string;
                let progressStage: string;
                if (event.stage === 'thinking') {
                  content = event.round <= 1 ? '正在思考...' : `第 ${event.round} 轮深度思考中...`;
                  progressStage = 'thinking';
                } else {
                  const docs = (event.docTitles || []).slice(0, 3);
                  content = docs.length > 0 ? `已读取：${docs.join('、')}` : `已检索到 ${event.chunkCount || 0} 条相关内容`;
                  progressStage = 'replying';
                }
                return { ...item, content, metadata: { ...(item.metadata || {}), pending: true, progress: true, progressStage } };
              }));
            },
          });
          setMessages((prev) => [
            ...prev.filter((item) => item.id !== optimisticUser.id && item.id !== optimisticAssistant.id),
            result.userMessage, result.assistantMessage,
          ]);
        } catch (batchError: any) {
          setMessages((prev) => prev.filter((item) => item.id !== optimisticUser.id && item.id !== optimisticAssistant.id));
          console.error('[BatchSend] batch error:', batchError?.name, batchError?.code, batchError?.status, batchError?.message, batchError);
          if (controller.signal.aborted || batchError?.name === 'AbortError' || batchError?.message === 'INTERRUPTED' || String(batchError?.message || '').includes('aborted')) {
            onStatusMessage(`批量分析已中断（已完成 ${batchIndex}/${totalBatches} 批）`);
          } else {
            onErrorMessage(`第 ${batchNum} 批发送失败：${batchError?.message || '未知错误'}`);
          }
          return;
        }
      }
    } finally {
      sendAbortControllerRef.current = null;
      setSending(false);
    }
  }, [session, selectedModel, reasoningLevel, webSearchEnabled, onStatusMessage, onErrorMessage]);

  const findUserQuestion = (msgId: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  };

  return (
    <div className={`${glassPanel} flex h-full min-h-0 flex-col p-3`}>
      <div className="mb-2 flex items-center justify-between rounded-[20px] border border-slate-200/80 bg-white/92 px-3.5 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-black text-slate-700">测试通道</p>
          <span className="rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">测试环境</span>
        </div>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={sending}
          className="rounded-full border border-slate-200/85 bg-white/90 px-2.5 py-1 text-[10px] font-black text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          重置对话
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <ChatConversationPane
          messages={messages}
          messageDraft={draft}
          onMessageDraftChange={setDraft}
          onSendMessage={handleSend}
          onInterruptSend={handleInterruptSend}
          selectedSession={session}
          selectedAgent={agent}
          currentUser={null}
          chatModels={selectableChatModels}
          selectedModel={selectedModel}
          onModelChange={(value) => {
            const nextReasoningLevel = resolveReasoningLevelForModel(value, null);
            setSelectedModel(value);
            setReasoningLevel(nextReasoningLevel);
            void syncSessionOptions({ selectedModel: value, reasoningLevel: nextReasoningLevel });
          }}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={(value) => {
            setReasoningLevel(value);
            void syncSessionOptions({ reasoningLevel: value });
          }}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={() => {
            const next = !webSearchEnabled;
            setWebSearchEnabled(next);
            void syncSessionOptions({ webSearchEnabled: next });
          }}
          attachments={attachments}
          onAddAttachments={(next) => {
            setAttachments((prev) => {
              const merged = [...prev, ...next];
              const imageItems = merged.filter((item) => item.kind === 'image').slice(0, imageMaxInputCount);
              const fileItems = merged.filter((item) => item.kind !== 'image');
              return [...imageItems, ...fileItems];
            });
          }}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
          imageModeEnabled={imageModeEnabled}
          imageModeAvailable={imageModeAvailable}
          imageMaxInputCount={imageMaxInputCount}
          onImageModeToggle={() => {
            const next = !imageModeEnabled;
            setImageModeEnabled(next);
            setAttachments((prev) => next ? prev.filter((item) => item.kind === 'image') : prev);
            void syncSessionOptions({ lastImageMode: next });
          }}
          sending={sending || loading}
          hideSessionHeader={true}
          renderMessageActions={(message) => {
            if (message.role !== 'assistant' || message.metadata?.pending) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFeedback((p) => ({ ...p, [message.id]: 'good' }))}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                    feedback[message.id] === 'good'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200/85 bg-white/90 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  👍 符合预期
                </button>
                <button
                  type="button"
                  onClick={() => setFeedback((p) => ({ ...p, [message.id]: 'bad' }))}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                    feedback[message.id] === 'bad'
                      ? 'border-rose-300 bg-rose-50 text-rose-600'
                      : 'border-slate-200/85 bg-white/90 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  👎 不对
                </button>
                <button
                  type="button"
                  onClick={() => onCorrection(findUserQuestion(message.id), message.content)}
                  className="rounded-full border border-slate-200/85 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:text-slate-700"
                >
                  ✏️ 纠正
                </button>
              </div>
            );
          }}
          onBatchSend={handleBatchSend}
        />
      </div>
    </div>
  );
};

export default AgentStudioTestingPane;
