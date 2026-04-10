import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AgentSummary, AgentVersion, StudioConfigDiff, StudioTrainingMessage, SystemPublicConfig } from '../../types';
import { applyStudioTrainingChanges, sendStudioTrainingMessage } from '../../services/internalApi';
import { estimateTokenCount } from './agentCenterUtils.mjs';
import AgentAvatar from './AgentAvatar';
import ChatComposer, { ComposerAttachment } from './ChatComposer';

interface Props {
  agent: AgentSummary;
  draftVersion: AgentVersion;
  availableChatModels: SystemPublicConfig['agentModels']['chat'];
  correctionContext: string;
  onCorrectionConsumed: () => void;
  onVersionUpdated: (v: AgentVersion) => void;
  onStatusMessage: (msg: string) => void;
  onErrorMessage: (msg: string) => void;
}

const glassPanel = 'rounded-[30px] border border-white/70 bg-white/72 shadow-[0_25px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl';
const AGENT_STUDIO_TRAINING_STATE_KEY = 'MEIAO_AGENT_STUDIO_TRAINING_STATE';

const summarizeDiff = (diff: StudioConfigDiff) => {
  if (diff.field === 'systemPrompt') return diff.after || '更新系统提示词';
  if (diff.field === 'knowledgeBaseIds') return `绑定 ${diff.knowledgeBaseIds?.length || 0} 个知识库`;
  if (diff.field === 'modelPolicy') {
    const parts = [
      diff.modelPolicy?.defaultModel ? `默认：${diff.modelPolicy.defaultModel}` : '',
      diff.modelPolicy?.cheapModel ? `简单：${diff.modelPolicy.cheapModel}` : '',
      diff.modelPolicy?.advancedModel ? `高级：${diff.modelPolicy.advancedModel}` : '',
      diff.modelPolicy?.multimodalModel ? `多模态：${diff.modelPolicy.multimodalModel}` : '',
    ].filter(Boolean);
    return parts.join('，') || '调整模型策略';
  }
  if (diff.field === 'retrievalPolicy') {
    return [
      diff.retrievalPolicy?.enabled === undefined ? '' : (diff.retrievalPolicy.enabled ? '开启检索' : '关闭检索'),
      diff.retrievalPolicy?.topK ? `参考数 ${diff.retrievalPolicy.topK}` : '',
      diff.retrievalPolicy?.maxChunks ? `片段上限 ${diff.retrievalPolicy.maxChunks}` : '',
    ].filter(Boolean).join('，') || '调整检索策略';
  }
  if (diff.field === 'knowledgeDocument') {
    const title = diff.knowledgeDocument?.title || diff.documentTitle || '知识库文档';
    return diff.action === 'remove' ? `删除 ${title}` : `${diff.action === 'add' ? '新增' : '更新'} ${title}`;
  }
  return diff.label;
};

const CHAT_REUSE_IMAGE_MIME = 'application/x-meiao-chat-image';

const renderMessageAttachments = (
  attachments: StudioTrainingMessage['attachments'],
  onReuseImage?: (url: string, name: string) => void,
) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment, index) => (
        attachment?.kind === 'image' && attachment.url ? (
          <div
            key={`${attachment.url || attachment.name || 'image'}-${index}`}
            className="group relative overflow-hidden rounded-[14px] border border-slate-200/80 bg-slate-100"
            draggable={Boolean(onReuseImage)}
            onDragStart={onReuseImage ? (event) => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData(CHAT_REUSE_IMAGE_MIME, JSON.stringify({
                url: attachment.url,
                name: attachment.name || `图片${index + 1}`,
                mimeType: 'image/png',
              }));
              event.dataTransfer.setData('text/plain', attachment.name || `图片${index + 1}`);
            } : undefined}
          >
            <a href={attachment.url} target="_blank" rel="noreferrer">
              <img src={attachment.url} alt={attachment.name || `附件${index + 1}`} className="h-20 w-20 object-cover" />
            </a>
            <span className="absolute inset-x-0 bottom-0 truncate bg-slate-950/62 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
              {attachment.name || `图片${index + 1}`}
            </span>
            {onReuseImage ? (
              <button
                type="button"
                onClick={() => onReuseImage(String(attachment.url), attachment.name || `图片${index + 1}`)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-600 opacity-0 shadow transition group-hover:opacity-100 hover:bg-white hover:text-slate-900"
                title="放入当前输入框"
              >
                <i className="fas fa-plus text-[10px]" />
              </button>
            ) : null}
          </div>
        ) : (
          <div
            key={`${attachment?.name || 'file'}-${index}`}
            className="inline-flex max-w-[220px] items-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-3 py-1.5 text-[11px] font-medium text-slate-600"
          >
            <i className="fas fa-file-lines text-[11px] text-slate-400" />
            <span className="truncate">{attachment?.name || `附件${index + 1}`}</span>
          </div>
        )
      ))}
    </div>
  );
};

const AgentStudioTrainingPane: React.FC<Props> = ({
  agent,
  draftVersion,
  availableChatModels,
  correctionContext,
  onCorrectionConsumed,
  onVersionUpdated,
  onStatusMessage,
  onErrorMessage,
}) => {
  const storageKey = useMemo(() => `${AGENT_STUDIO_TRAINING_STATE_KEY}:${agent.id}:${draftVersion.id}`, [agent.id, draftVersion.id]);
  const readStoredTrainingState = () => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const initialStoredState = readStoredTrainingState();
  const [messages, setMessages] = useState<StudioTrainingMessage[]>(Array.isArray(initialStoredState?.messages) ? initialStoredState.messages : []);
  const [draft, setDraft] = useState(String(initialStoredState?.draft || ''));
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(Array.isArray(initialStoredState?.attachments) ? initialStoredState.attachments : []);
  const [selectedModel, setSelectedModel] = useState(String(initialStoredState?.selectedModel || ''));
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(initialStoredState?.reasoningLevel || null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(Boolean(initialStoredState?.webSearchEnabled));
  const [applyingIds, setApplyingIds] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selectableChatModels = useMemo(() => {
    const allowed = new Set((draftVersion.allowedChatModels || []).filter(Boolean));
    const source = Array.isArray(availableChatModels) ? availableChatModels : [];
    if (!allowed.size) return source;
    const filtered = source.filter((item) => allowed.has(item.id));
    return filtered.length ? filtered : source;
  }, [availableChatModels, draftVersion.allowedChatModels]);

  useEffect(() => {
    if (correctionContext) {
      setDraft(correctionContext);
      onCorrectionConsumed();
    }
  }, [correctionContext, onCorrectionConsumed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const nextModel = draftVersion.defaultChatModel || selectableChatModels[0]?.id || '';
    setSelectedModel((current) => (current && selectableChatModels.some((item) => item.id === current) ? current : nextModel));
    setReasoningLevel((current) => current);
    setWebSearchEnabled((current) => current);
  }, [draftVersion.defaultChatModel, selectableChatModels]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        messages,
        draft,
        attachments,
        selectedModel,
        reasoningLevel,
        webSearchEnabled,
      }));
    } catch {
      // ignore storage errors
    }
  }, [attachments, draft, messages, reasoningLevel, selectedModel, storageKey, webSearchEnabled]);

  const totalTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);

  const updateMessageDiffs = (messageId: string, updater: (diffs: StudioConfigDiff[]) => StudioConfigDiff[]) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !Array.isArray(message.configDiffs)) return message;
      return { ...message, configDiffs: updater(message.configDiffs) };
    }));
  };

  const handleIgnoreChanges = (messageId: string, diffIds: string[]) => {
    updateMessageDiffs(messageId, (diffs) => diffs.map((diff) => (
      diffIds.includes(diff.id) ? { ...diff, status: 'ignored' } : diff
    )));
  };

  const handleApplyChanges = async (messageId: string, changes: StudioConfigDiff[]) => {
    const pendingChanges = changes.filter((diff) => diff.status !== 'applied' && diff.status !== 'ignored');
    if (!pendingChanges.length || applyingIds.length > 0) return;
    const ids = pendingChanges.map((diff) => diff.id);
    setApplyingIds(ids);
    try {
      const result = await applyStudioTrainingChanges(draftVersion.id, { changes: pendingChanges });
      const appliedIds = new Set((result.appliedChanges || []).map((diff) => diff.id));
      updateMessageDiffs(messageId, (diffs) => diffs.map((diff) => (
        ids.includes(diff.id)
          ? { ...diff, status: appliedIds.has(diff.id) ? 'applied' : diff.status }
          : diff
      )));
      if (result.updatedVersion) {
        onVersionUpdated(result.updatedVersion);
      }
      onStatusMessage(`已应用 ${appliedIds.size} 条训练改动`);
    } catch (err: any) {
      onErrorMessage(err.message || '训练改动应用失败');
    } finally {
      setApplyingIds([]);
    }
  };

  const handleReuseImage = (url: string, name: string) => {
    setAttachments((prev) => [...prev, {
      id: `reuse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      kind: 'image',
      url,
      mimeType: 'image/png',
    }]);
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (sending || (!content && attachments.length === 0)) return;
    const attachmentPayload = attachments.map((item) => ({
      name: item.name,
      kind: item.kind,
      url: item.url,
      mimeType: item.mimeType,
    }));
    const userMsg: StudioTrainingMessage = {
      id: `train-u-${Date.now()}`,
      role: 'user',
      content,
      attachments: attachmentPayload,
      selectedModel,
      reasoningLevel,
      webSearchEnabled,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setAttachments([]);
    setSending(true);
    try {
      const history = [...messages, userMsg].map((message) => ({
        role: message.role,
        content: message.content,
        attachments: Array.isArray(message.attachments)
          ? message.attachments.map((item) => ({
              name: item.name,
              kind: item.kind === 'image' ? 'image' : 'file',
              url: item.url,
              mimeType: item.mimeType,
            }))
          : [],
      }));
      const result = await sendStudioTrainingMessage(draftVersion.id, {
        content,
        history,
        attachments: attachmentPayload,
        selectedModel,
        reasoningLevel,
        webSearchEnabled,
      });
      const assistantMsg: StudioTrainingMessage = {
        id: `train-a-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        configDiffs: (result.configDiffs as StudioConfigDiff[]).map((diff) => ({ ...diff, status: 'pending' })),
        selectedModel,
        reasoningLevel,
        webSearchEnabled,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (result.configDiffs?.length > 0) onStatusMessage(`已生成 ${result.configDiffs.length} 条待确认改动`);
    } catch (err: any) {
      onErrorMessage(err.message || '训练消息发送失败');
      setMessages((prev) => prev.filter((message) => message.id !== userMsg.id));
      setDraft(content);
      setAttachments(attachments);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`${glassPanel} flex h-full min-h-0 flex-col p-3`}>
      <div className="rounded-[20px] border border-slate-200/80 bg-white/92 px-3.5 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-[12px] font-black text-slate-700">训练通道</p>
            <span className="rounded-full border border-cyan-200/80 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
              建议后确认应用
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200/85 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
              {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tokens
            </span>
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setAttachments([]);
                setDraft('');
              }}
              className="rounded-full border border-rose-200/90 bg-rose-50/92 px-3 py-1.5 text-[11px] font-black text-rose-600 shadow-[0_8px_18px_rgba(244,63,94,0.08)] transition hover:border-rose-300 hover:bg-rose-100/92 hover:text-rose-700"
              title="清空当前训练对话与暂存输入"
            >
              <i className="fas fa-trash-can mr-1.5 text-[10px]" />
              清空对话
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-[20px] border border-slate-200/75 bg-white/84 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[13px] font-semibold text-slate-500">告诉我要怎么调整智能体</p>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">例如：把退款规则改成7天内无条件退</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' ? (
                  <AgentAvatar
                    name={`${agent.name} 训练助手`}
                    iconUrl={agent.iconUrl || undefined}
                    avatarPreset={agent.avatarPreset || undefined}
                    className="mt-0.5 h-8 w-8 rounded-[12px] text-xs shadow-[0_8px_18px_rgba(56,189,248,0.14)]"
                  />
                ) : null}
                <div className={`max-w-[72%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-slate-400">{msg.role === 'user' ? '管理员' : '训练助手'}</span>
                    {msg.selectedModel ? (
                      <span className="rounded-full border border-slate-200/90 bg-white/88 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        {selectableChatModels.find((item) => item.id === msg.selectedModel)?.label || msg.selectedModel}
                      </span>
                    ) : null}
                    {msg.webSearchEnabled ? (
                      <span className="rounded-full border border-emerald-200/90 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        联网
                      </span>
                    ) : null}
                    {msg.reasoningLevel ? (
                      <span className="rounded-full border border-violet-200/90 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                        {msg.reasoningLevel}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={`rounded-[18px] px-3.5 py-2.5 text-[13px] leading-6 shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${
                      msg.role === 'user'
                        ? 'bg-[#2f394b] text-white'
                        : 'border border-slate-200/80 bg-white text-slate-700'
                    }`}
                  >
                    <p className="select-text whitespace-pre-wrap break-words">{msg.content || '已发送附件'}</p>
                    {renderMessageAttachments(msg.attachments, msg.role === 'assistant' ? handleReuseImage : undefined)}
                  </div>
                  {msg.role === 'assistant' && Array.isArray(msg.configDiffs) && msg.configDiffs.length > 0 ? (
                    <div className="mt-2 w-full space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-black text-slate-500">待确认改动</p>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleApplyChanges(msg.id, msg.configDiffs || [])}
                            disabled={!msg.configDiffs.some((diff) => diff.status === 'pending') || applyingIds.length > 0}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            全部应用
                          </button>
                          <button
                            type="button"
                            onClick={() => handleIgnoreChanges(msg.id, (msg.configDiffs || []).filter((diff) => diff.status === 'pending').map((diff) => diff.id))}
                            disabled={!msg.configDiffs.some((diff) => diff.status === 'pending') || applyingIds.length > 0}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            全部忽略
                          </button>
                        </div>
                      </div>
                      {msg.configDiffs.map((diff, index) => (
                        <div key={diff.id || `${diff.field}-${index}`} className="rounded-[14px] border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-emerald-800">{diff.label}</p>
                              <p className="mt-1 text-[11px] font-medium leading-5 text-emerald-700">{summarizeDiff(diff)}</p>
                              {diff.before ? <p className="mt-1 text-[11px] leading-5 text-red-400 line-through">{diff.before.slice(0, 120)}</p> : null}
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                              diff.status === 'applied'
                                ? 'bg-emerald-100 text-emerald-700'
                                : diff.status === 'ignored'
                                  ? 'bg-slate-200 text-slate-500'
                                  : 'bg-white text-slate-600'
                            }`}>
                              {diff.status === 'applied' ? '已应用' : diff.status === 'ignored' ? '已忽略' : '待确认'}
                            </span>
                          </div>
                          {diff.status === 'pending' ? (
                            <div className="mt-2 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleApplyChanges(msg.id, [diff])}
                                disabled={applyingIds.includes(diff.id)}
                                className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {applyingIds.includes(diff.id) ? '应用中...' : '应用'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleIgnoreChanges(msg.id, [diff.id])}
                                disabled={applyingIds.includes(diff.id)}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                忽略
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {msg.role === 'user' ? (
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[12px] bg-gradient-to-br from-slate-700 to-slate-900 text-[10px] font-bold text-white shadow-[0_8px_18px_rgba(15,23,42,0.1)]">
                    管
                  </div>
                ) : null}
              </div>
            ))}
            {sending ? (
              <div className="flex justify-start gap-2.5">
                <AgentAvatar
                  name={`${agent.name} 训练助手`}
                  iconUrl={agent.iconUrl || undefined}
                  avatarPreset={agent.avatarPreset || undefined}
                  className="mt-0.5 h-8 w-8 rounded-[12px] text-xs"
                />
                <div className="rounded-[18px] border border-slate-200/80 bg-white px-3.5 py-2.5 text-[13px] text-slate-400">
                  <i className="fas fa-spinner animate-spin text-[11px]" /> 思考中...
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-2">
        <ChatComposer
          messageDraft={draft}
          onMessageDraftChange={setDraft}
          onSendMessage={() => {
            void handleSend();
          }}
          disabled={false}
          sending={sending}
          chatModels={selectableChatModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={setReasoningLevel}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={() => setWebSearchEnabled((current) => !current)}
          attachments={attachments}
          onAddAttachments={(next) => setAttachments((prev) => [...prev, ...next])}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
          imageModeEnabled={false}
          imageModeAvailable={false}
          imageMaxInputCount={1}
          onImageModeToggle={() => {}}
        />
      </div>
    </div>
  );
};

export default AgentStudioTrainingPane;
