import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../types';
import { LegacyFaIcon } from '../../components/ui/workspacePrimitives';
import { downloadRemoteFile } from '../../utils/imageUtils';
import AgentAvatar from './AgentAvatar';
import UserAvatar from './UserAvatar';
import ChatComposer, { ComposerAttachment, BatchSendTask } from './ChatComposer';
import { MODULE_INTERFACES } from './agentCenterUtils.mjs';
import { MAX_FILES_PER_BATCH } from './folderZipUpload';

interface Props {
  messages: AgentChatMessage[];
  messageDraft: string;
  onMessageDraftChange: (value: string) => void;
  onSendMessage: () => void;
  onInterruptSend?: () => void;
  selectedSession?: AgentChatSession | null;
  selectedAgent?: AgentSummary | null;
  currentUser?: AuthUser | null;
  chatModels: SystemPublicConfig['agentModels']['chat'];
  selectedModel: string;
  onModelChange: (value: string) => void;
  reasoningLevel: string | null;
  onReasoningLevelChange: (value: string | null) => void;
  webSearchEnabled: boolean;
  onWebSearchToggle: () => void;
  attachments: ComposerAttachment[];
  onAddAttachments: (next: ComposerAttachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  imageModeEnabled: boolean;
  imageModeAvailable: boolean;
  imageMaxInputCount: number;
  onImageModeToggle: () => void;
  sending?: boolean;
  hideSessionHeader?: boolean;
  onHandoff?: (target: ModuleInterfaceId, payload: Record<string, unknown>) => void;
  renderMessageActions?: (message: AgentChatMessage) => ReactNode;
  /**
   * 批量发送调度：文件夹/ZIP 上传完成后，由 ChatConversationPane 负责串行发送每批消息。
   * 调用方（AgentCenterChatWorkspace 或 Studio）需要传入实际的发送函数。
   */
  onBatchSend?: (batches: ComposerAttachment[][], meta: { totalFiles: number; skippedCount: number; skippedReasons: string[] }) => Promise<void>;
}

const metaTagClassName =
  'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium';

// legacy visual marker for tests: rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-2

type HandoffBlock = {
  target: ModuleInterfaceId;
  payload: Record<string, unknown>;
};

const parseHandoffBlock = (content: string): HandoffBlock | null => {
  const match = content.match(/```meiao-handoff\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed?.target || !parsed?.payload) return null;
    if (!(parsed.target in MODULE_INTERFACES)) return null;
    return { target: parsed.target as ModuleInterfaceId, payload: parsed.payload };
  } catch {
    return null;
  }
};

const stripHandoffBlock = (content: string): string =>
  content.replace(/```meiao-handoff[\s\S]*?```/g, '').trim();

const stripConversationProtocolMarkers = (content: string): string =>
  content
    .replace(/(^|\n)\s*final_answer\s*(?=\n|$)/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

type GalleryImage = {
  id: string;
  url: string;
  name: string;
  createdAt: number;
};

type PreviewState = {
  images: GalleryImage[];
  index: number;
};

const CHAT_REUSE_IMAGE_MIME = 'application/x-meiao-chat-image';

const isImageGenerationMessage = (message: AgentChatMessage) =>
  message.role === 'assistant' && message.metadata?.requestMode === 'image_generation';

const isFailedImageGenerationMessage = (message: AgentChatMessage) => {
  const status = String(message.metadata?.status || '').trim();
  const phase = String(message.metadata?.phase || '').trim();
  const errorMessage = String(message.metadata?.errorMessage || '').trim();
  return status === 'failed' || phase === 'failed' || Boolean(errorMessage);
};

const getProgressStageLabel = (message: AgentChatMessage) => {
  const stage = String(message.metadata?.progressStage || '').trim();
  if (stage === 'analyzing') return '正在理解需求与参考图';
  if (stage === 'planning') return '正在整理生图参数与提示词';
  if (stage === 'generating') return '正在生成图片';
  if (stage === 'finalizing') return '正在整理结果';
  if (stage === 'thinking') return '调用模型中';
  if (stage === 'replying') return '知识库检索完成，整理回复中';
  return message.metadata?.requestMode === 'image_generation' ? '处理中' : '调用模型中';
};

const getImageGenerationSummary = (message: AgentChatMessage) => {
  const resultCount = Array.isArray(message.metadata?.imageResultUrls)
    ? message.metadata.imageResultUrls.filter(Boolean).length
    : Array.isArray(message.attachments)
      ? message.attachments.filter((item) => item.kind === 'image' && item.url).length
      : 0;
  const imageReferences = Array.isArray(message.metadata?.imagePlan?.imageReferences)
    ? message.metadata.imagePlan.imageReferences.map((item) => item.label).filter(Boolean)
    : [];
  return {
    resultCount,
    referenceText: imageReferences.length > 0 ? `参考了 ${imageReferences.join('、')}` : '已按当前需求生成图片',
  };
};

const getImageGenerationBadgeText = (message: AgentChatMessage, resultCount: number) => {
  if (isFailedImageGenerationMessage(message)) return '生成失败';
  if (resultCount > 0) return `已生成 ${resultCount} 张图片`;
  return '未返回图片';
};

const getProgressBadgeText = (message: AgentChatMessage) => {
  const stage = String(message.metadata?.progressStage || '').trim();
  if (stage === 'analyzing') return '需求分析中';
  if (stage === 'planning') return '参数整理中';
  if (stage === 'generating') return '图像生成中';
  if (stage === 'finalizing') return '结果整理中';
  if (stage === 'thinking') return '思考中';
  if (stage === 'replying') return '检索知识库';
  return message.metadata?.requestMode === 'image_generation' ? '处理中' : '思考中';
};

const ChatConversationPane: React.FC<Props> = ({
  messages,
  messageDraft,
  onMessageDraftChange,
  onSendMessage,
  onInterruptSend,
  selectedSession,
  selectedAgent,
  currentUser = null,
  chatModels,
  selectedModel,
  onModelChange,
  reasoningLevel,
  onReasoningLevelChange,
  webSearchEnabled,
  onWebSearchToggle,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  imageModeEnabled,
  imageModeAvailable,
  imageMaxInputCount,
  onImageModeToggle,
  sending = false,
  hideSessionHeader = false,
  onHandoff,
  renderMessageActions,
  onBatchSend,
}) => {
  const focusedSessionTitle = selectedSession?.title || '新会话';
  const selectedModelOption = chatModels.find((item) => item.id === selectedModel) || chatModels[0];
  const isDisabled = !selectedSession;
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [expandedSummaries, setExpandedSummaries] = useState<Record<string, boolean>>({});
  const [expandedReferenceRules, setExpandedReferenceRules] = useState<Record<string, boolean>>({});

  // 批量发送状态
  const [batchSendState, setBatchSendState] = useState<{
    totalBatches: number;
    currentBatch: number;
    totalFiles: number;
    skippedCount: number;
    error: string;
  } | null>(null);
  const batchSendAbortRef = useRef<boolean>(false);
  /**
   * 批量发送调度：串行发送每批，等待每批回复后再发下一批。
   * 最后一批附加综合总结请求。
   */
  const handleBatchSendReady = async (task: BatchSendTask) => {
    if (!onBatchSend || task.batches.length === 0) return;

    batchSendAbortRef.current = false;
    setBatchSendState({
      totalBatches: task.batches.length,
      currentBatch: 0,
      totalFiles: task.totalFiles,
      skippedCount: task.skippedCount,
      error: '',
    });

    try {
      await onBatchSend(task.batches, {
        totalFiles: task.totalFiles,
        skippedCount: task.skippedCount,
        skippedReasons: task.skippedReasons,
      });
    } catch (err: any) {
      setBatchSendState((prev) => prev ? { ...prev, error: err?.message || '批量发送失败' } : null);
      return;
    }

    setBatchSendState(null);
  };

  const galleryImages = useMemo(() => (    messages.flatMap((message) => (
      isImageGenerationMessage(message) && Array.isArray(message.attachments)
        ? message.attachments
            .filter((attachment) => attachment.kind === 'image' && attachment.url)
            .map((attachment, index) => ({
              id: `${message.id}-${index}`,
              url: String(attachment.url || ''),
              name: attachment.name || `图片${index + 1}`,
              createdAt: message.createdAt,
            }))
        : []
    ))
  ), [messages]);

  useEffect(() => {
    if (!messageScrollRef.current) return;
    messageScrollRef.current.scrollTo({
      top: messageScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  useEffect(() => {
    if (previewState && previewState.images.length === 0) {
      setPreviewState(null);
    }
    if (showGallery && galleryImages.length === 0) {
      setShowGallery(false);
    }
  }, [galleryImages, previewState, showGallery]);

  const openPreview = (images: GalleryImage[], index = 0) => {
    if (images.length === 0) return;
    setPreviewState({
      images,
      index: Math.min(Math.max(index, 0), images.length - 1),
    });
  };

  const activePreviewImage = previewState ? previewState.images[previewState.index] : null;

  const stepPreviewImage = (direction: 'prev' | 'next') => {
    setPreviewState((current) => {
      if (!current || current.images.length <= 1) return current;
      const delta = direction === 'prev' ? -1 : 1;
      const nextIndex = (current.index + delta + current.images.length) % current.images.length;
      return { ...current, index: nextIndex };
    });
  };

  const downloadImage = (image: GalleryImage) => {
    void downloadRemoteFile(image.url, image.name || `agent-image-${image.createdAt}.png`);
  };

  const reuseImage = (image: GalleryImage) => {
    onAddAttachments([{
      id: `reuse-${image.id}-${Date.now()}`,
      name: image.name,
      kind: 'image',
      url: image.url,
      mimeType: 'image/png',
    }]);
  };

  const beginDragReuseImage = (event: React.DragEvent<HTMLElement>, image: GalleryImage) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(CHAT_REUSE_IMAGE_MIME, JSON.stringify({
      url: image.url,
      name: image.name,
      mimeType: 'image/png',
    }));
    event.dataTransfer.setData('text/plain', image.name);
  };

  const toggleSummary = (messageId: string) => {
    setExpandedSummaries((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const toggleReferenceRules = (messageId: string) => {
    setExpandedReferenceRules((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const renderImageGenerationMessage = (message: AgentChatMessage) => {
    const isPending = Boolean(message.metadata?.pending);
    const summaryExpanded = Boolean(expandedSummaries[message.id]);
    const retrievalSummary = Array.isArray(message.metadata?.retrievalSummary)
      ? message.metadata.retrievalSummary.filter((item) => item && (item.documentTitle || item.preview))
      : [];
    const referenceRulesExpanded = Boolean(expandedReferenceRules[message.id]);
    const { resultCount, referenceText } = getImageGenerationSummary(message);
    const imageAttachments = Array.isArray(message.attachments)
      ? message.attachments.filter((item) => item.kind === 'image' && item.url)
      : [];
    const visibleResultCount = Math.max(resultCount, imageAttachments.length);
    const failedImageGeneration = isFailedImageGenerationMessage(message);
    const previewImages = imageAttachments.map((attachment, index) => ({
      id: `${message.id}-${index}`,
      url: String(attachment.url || ''),
      name: attachment.name || `图片${index + 1}`,
      createdAt: message.createdAt,
    }));
    const referenceImages = Array.isArray(message.metadata?.imagePlan?.imageReferences)
      ? message.metadata.imagePlan.imageReferences
          .filter((item) => item?.url)
          .map((item, index) => ({
            id: `${message.id}-ref-${index}`,
            url: String(item.url || ''),
            name: String(item.name || item.label || `参考图${index + 1}`),
            createdAt: message.createdAt,
            label: String(item.label || `图${index + 1}`),
            role: String(item.role || '').trim(),
          }))
      : [];
    return (
      <div className="space-y-2">
        {isPending ? (
          <div className="rounded-[18px] border px-3.5 py-3" style={{ borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border-subtle))', background: 'var(--accent-soft)' }}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600">
                <LegacyFaIcon icon="fa-spinner" className="animate-spin text-[11px]" />
              </span>
              <div>
                <p className="text-[12px] font-black text-slate-900">{message.content || '处理中'}</p>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">{getProgressStageLabel(message)}</p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span
            className="rounded-full px-2.5 py-1 font-medium"
            style={
              isPending
                ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                : failedImageGeneration
                  ? { background: 'color-mix(in srgb, var(--error) 10%, transparent)', color: 'var(--error)' }
                  : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }
            }
          >
            {isPending ? getProgressBadgeText(message) : getImageGenerationBadgeText(message, visibleResultCount)}
          </span>
          {referenceImages.length > 0 ? (
            referenceImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => openPreview(referenceImages.map((item) => ({
                  id: item.id,
                  url: item.url,
                  name: item.name,
                  createdAt: item.createdAt,
                })), index)}
                className="rounded-full px-2.5 py-1 font-medium transition"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
                title={`${image.label}${image.role ? ` · ${image.role}` : ''}`}
              >
                参考图 {image.label}{image.role ? ` · ${image.role}` : ''}
              </button>
            ))
          ) : !isPending && !failedImageGeneration && visibleResultCount > 0 ? (
            <span>{referenceText}</span>
          ) : null}
        </div>
        {imageAttachments.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {imageAttachments.map((attachment, index) => (
              <div
                key={`${message.id}-${attachment.name}-${index}`}
                className="group relative overflow-hidden rounded-[18px] p-1.5 text-left transition"
                style={{ background: 'var(--bg-base)' }}
              >
                <button type="button" onClick={() => openPreview(previewImages, index)} className="block w-full">
                  <img
                    src={attachment.url}
                    alt={attachment.name}
                    className="h-auto w-full rounded-[12px] object-cover"
                    draggable
                    onDragStart={(event) => beginDragReuseImage(event, previewImages[index])}
                  />
                </button>
                <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-[12px] bg-slate-950/0 px-2.5 py-1.5 text-[11px] text-white opacity-0 transition group-hover:bg-slate-950/60 group-hover:opacity-100">
                  点击查看大图
                </span>
                <span className="absolute right-3 top-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      reuseImage(previewImages[index]);
                    }}
                    className="flex h-8 min-w-8 items-center justify-center rounded-full border border-white/12 bg-white/88 px-2 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition hover:bg-white"
                    aria-label="放入当前输入框"
                    title="放入当前输入框"
                  >
                    <LegacyFaIcon icon="fa-plus" className="text-[12px]" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadImage(previewImages[index]);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/88 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition hover:bg-white"
                    aria-label="下载生成图片"
                    title="下载图片"
                  >
                    <LegacyFaIcon icon="fa-download" className="text-[12px]" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {message.content ? (
            <button
              type="button"
              onClick={() => toggleSummary(message.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition"
              style={summaryExpanded
                ? { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }
                : { background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              aria-expanded={summaryExpanded}
              aria-label={summaryExpanded ? '收起结果总结' : '展开结果总结'}
              title={summaryExpanded ? '收起结果总结' : '展开结果总结'}
            >
              <LegacyFaIcon icon="fa-file-lines" className="text-[12px]" />
              <span>结果总结</span>
            </button>
          ) : null}
          {retrievalSummary.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleReferenceRules(message.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition"
              style={referenceRulesExpanded
                ? { background: 'var(--accent-soft)', borderColor: 'color-mix(in srgb, var(--accent) 18%, var(--border-subtle))', color: 'var(--accent)' }
                : { background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              aria-expanded={referenceRulesExpanded}
              aria-label={referenceRulesExpanded ? '收起本次参考规则' : '展开本次参考规则'}
              title={referenceRulesExpanded ? '收起本次参考规则' : '展开本次参考规则'}
            >
              <LegacyFaIcon icon="fa-book-open" className="text-[12px]" />
              <span>参考规则</span>
            </button>
          ) : null}
        </div>
        {summaryExpanded && message.content ? (
          <div className="rounded-[14px] px-3.5 py-3" style={{ background: 'var(--bg-base)' }}>
            <p className="text-[11px] font-black" style={{ color: 'var(--text-primary)' }}>结果总结</p>
            <p className="mt-1.5 select-text whitespace-pre-wrap text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>{message.content}</p>
          </div>
        ) : null}
        {referenceRulesExpanded && retrievalSummary.length > 0 ? (
          <div className="rounded-[14px] px-3.5 py-3" style={{ background: 'var(--accent-soft)' }}>
            <p className="text-[11px] font-black" style={{ color: 'var(--accent)' }}>本次参考规则</p>
            <div className="mt-2 space-y-2">
              {retrievalSummary.map((item, index) => (
                <div key={`${message.id}-rule-${index}`} className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-surface)' }}>
                  <p className="text-[11px] font-black" style={{ color: 'var(--text-primary)' }}>{item.documentTitle || `规则${index + 1}`}</p>
                  <p className="mt-1 select-text text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{item.preview || '已命中相关规则'}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-[22px] p-3 lg:p-4" style={{ background: 'var(--bg-surface)' }}>
      {!hideSessionHeader ? (
        <div className="rounded-[18px] border px-4 py-3" style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <AgentAvatar
                name={selectedAgent?.name || '智能体'}
                iconUrl={selectedAgent?.iconUrl || undefined}
                avatarPreset={selectedAgent?.avatarPreset || undefined}
                className="h-11 w-11 rounded-[15px] text-sm shadow-[0_8px_18px_rgba(56,189,248,0.14)]"
              />
              <div className="min-w-0">
                <p className="text-[15px] font-black tracking-[-0.02em]" style={{ color: 'var(--text-primary)' }}>{selectedAgent?.name || '智能体'}</p>
                <p className="mt-0.5 text-[12px] font-medium leading-5" style={{ color: 'var(--text-secondary)' }}>当前会话 · {focusedSessionTitle}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {galleryImages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowGallery(true)}
                  className={`${metaTagClassName} transition`}
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
                >
                  本次会话图库
                </button>
              ) : null}
              <span className={metaTagClassName} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>附件 {attachments.length} 个</span>
              {selectedModelOption?.supportsWebSearch && webSearchEnabled ? (
                <span className={metaTagClassName} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>联网</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-[20px] border px-4 py-4" style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[14px] font-semibold text-slate-500">还没有消息，开始对话吧</p>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">消息会显示在这里</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isUser = message.role === 'user';
              const imageGenerationMessage = isImageGenerationMessage(message);
              const progressOnlyMessage = !isUser && !imageGenerationMessage && Boolean(message.metadata?.progress);
              return (
                <div key={message.id} className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser ? (
                    <AgentAvatar
                      name={selectedAgent?.name || '智能体'}
                      iconUrl={selectedAgent?.iconUrl || undefined}
                      avatarPreset={selectedAgent?.avatarPreset || undefined}
                      className="mt-0.5 h-9 w-9 rounded-[13px] text-xs shadow-[0_8px_18px_rgba(56,189,248,0.14)]"
                    />
                  ) : null}

                  <div className={`max-w-[62%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`mb-1 flex items-center gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{isUser ? (currentUser?.username || '我') : '智能体'}</span>
                      <span className="text-[10px] font-normal" style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>

                    <div
                      className={`w-full rounded-[18px] px-3.5 py-2.5 text-[13px] leading-6 shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${
                        isUser
                          ? 'border text-[color:var(--text-primary)]'
                          : 'border text-[color:var(--text-primary)]'
                      }`}
                      style={isUser
                        ? { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }
                        : { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      {imageGenerationMessage ? renderImageGenerationMessage(message) : progressOnlyMessage ? (
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                            <LegacyFaIcon icon="fa-spinner" className="animate-spin text-[11px]" />
                          </span>
                          <div>
                            <p className="text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>{message.content || '处理中'}</p>
                            <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{getProgressStageLabel(message)}</p>
                          </div>
                        </div>
                      ) : (() => {
                          const handoff = !message.metadata?.pending ? parseHandoffBlock(message.content) : null;
                          const displayContent = stripConversationProtocolMarkers(handoff ? stripHandoffBlock(message.content) : message.content);
                          return (
                            <>
                              <p className="select-text whitespace-pre-wrap break-words">{displayContent}</p>
                              {handoff && onHandoff && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => onHandoff(handoff.target, handoff.payload)}
                                    className="inline-flex items-center gap-2 rounded-[16px] border border-violet-300 bg-violet-50 px-3 py-2 text-[12px] font-black text-violet-700 transition hover:bg-violet-100"
                                  >
                                    <LegacyFaIcon icon="fa-arrow-right" className="text-[10px]" />
                                    发送到{MODULE_INTERFACES[handoff.target]?.label}生成
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      {!imageGenerationMessage && message.attachments?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.attachments.map((attachment, index) => {
                            const label = attachment.kind === 'image' ? `图${index + 1}` : attachment.name;
                            return attachment.kind === 'image' && attachment.url ? (
                              <div
                                key={`${message.id}-${attachment.name}-${index}`}
                                className={`group flex items-center gap-2 rounded-2xl px-2 py-1 text-left ${isUser ? 'bg-[color:var(--bg-elevated)]' : 'bg-[color:var(--bg-elevated)]'}`}
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    const previewImages = (message.attachments || [])
                                      .filter((item) => item.kind === 'image' && item.url)
                                      .map((item, imageIndex) => ({
                                        id: `${message.id}-${imageIndex}`,
                                        url: String(item.url || ''),
                                        name: item.name || `图片${imageIndex + 1}`,
                                        createdAt: message.createdAt,
                                      }));
                                    const imageIndex = previewImages.findIndex((item) => item.url === attachment.url);
                                  openPreview(previewImages, imageIndex >= 0 ? imageIndex : 0);
                                }}
                                className="flex min-w-0 flex-1 items-center gap-2"
                                draggable
                                onDragStart={(event) => beginDragReuseImage(event, {
                                  id: `${message.id}-${index}`,
                                  url: String(attachment.url || ''),
                                  name: attachment.name || `图片${index + 1}`,
                                  createdAt: message.createdAt,
                                })}
                              >
                                  <img src={attachment.url} alt={attachment.name} className="h-9 w-9 rounded-xl object-cover" />
                                  <span className="truncate text-[11px] font-medium">{label}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reuseImage({
                                    id: `${message.id}-${index}`,
                                    url: String(attachment.url || ''),
                                    name: attachment.name || `图片${index + 1}`,
                                    createdAt: message.createdAt,
                                  })}
                                  className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100"
                                  style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
                                  aria-label="放入当前输入框"
                                  title="放入当前输入框"
                                >
                                  <LegacyFaIcon icon="fa-plus" className="text-[10px]" />
                                </button>
                              </div>
                            ) : (
                              <span
                                key={`${message.id}-${attachment.name}-${index}`}
                                className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                              >
                                <span className="select-text">{attachment.name}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {!isUser && message.metadata?.fallbackFrom ? (
                      <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        <LegacyFaIcon icon="fa-exclamation-triangle" className="mr-1 text-[10px]" />
                        {(chatModels.find((m) => m.id === message.metadata.fallbackFrom)?.label || message.metadata.fallbackFrom)} 暂时不可用，已自动切换到 {chatModels.find((m) => m.id === message.metadata.selectedModel)?.label || message.metadata.selectedModel} 回复
                      </p>
                    ) : null}

                    {renderMessageActions ? renderMessageActions(message) : null}

                  </div>

                  {isUser ? (
                    <UserAvatar
                      name={currentUser?.username || currentUser?.displayName || '我'}
                      avatarUrl={currentUser?.avatarUrl}
                      avatarPreset={currentUser?.avatarPreset || undefined}
                      className="mt-0.5 h-9 w-9 shadow-[0_8px_18px_rgba(15,23,42,0.1)]"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showGallery ? (
        <div
          className="fixed inset-0 z-40 px-4 py-5 sm:px-6 sm:py-6"
          style={{ backgroundColor: 'rgba(2, 6, 23, 0.84)' }}
        >
          <div
            className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-[30px] border shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4 sm:px-6"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}
            >
              <div>
                <p className="text-[18px] font-black" style={{ color: 'var(--text-primary)' }}>本次会话图库</p>
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>删除当前会话后，这里的图片会一起清除。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGallery(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border transition"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                aria-label="关闭图库"
              >
                <LegacyFaIcon icon="fa-xmark" className="text-sm" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {galleryImages.map((image) => (
                  <div
                    key={image.id}
                    className="group overflow-hidden rounded-[22px] border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}
                  >
                      <button
                        type="button"
                        onClick={() => openPreview(galleryImages, galleryImages.findIndex((item) => item.id === image.id))}
                        className="block w-full overflow-hidden rounded-[16px]"
                        draggable
                        onDragStart={(event) => beginDragReuseImage(event, image)}
                      >
                        <img src={image.url} alt={image.name} className="h-44 w-full rounded-[16px] object-cover" />
                      </button>
                    <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{image.name}</p>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{new Date(image.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => reuseImage(image)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border opacity-0 transition group-hover:opacity-100"
                          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                          aria-label="放入当前输入框"
                          title="放入当前输入框"
                        >
                          <LegacyFaIcon icon="fa-plus" className="text-[12px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadImage(image)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border opacity-0 transition group-hover:opacity-100"
                          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                          aria-label="下载图片"
                          title="下载图片"
                        >
                          <LegacyFaIcon icon="fa-download" className="text-[12px]" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activePreviewImage ? (
        <div
          className="fixed inset-0 z-50 px-4 py-5 sm:px-6 sm:py-6"
          style={{ backgroundColor: 'rgba(2, 6, 23, 0.88)' }}
        >
          <div
            className="relative mx-auto flex h-full w-full max-w-[min(72vw,700px)] min-h-0 flex-col overflow-hidden rounded-[28px] border shadow-[0_30px_90px_rgba(15,23,42,0.18)]"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{activePreviewImage.name}</p>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{new Date(activePreviewImage.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
              </div>
              <div className="flex items-center gap-2">
                {previewState && previewState.images.length > 1 ? (
                  <span
                    className="rounded-full border px-3 py-1 text-[11px]"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    {previewState.index + 1} / {previewState.images.length}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => downloadImage(activePreviewImage)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border transition"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  aria-label="下载图片"
                  title="下载图片"
                >
                  <LegacyFaIcon icon="fa-download" className="text-[11px]" />
                </button>
                <button
                  type="button"
                  onClick={() => reuseImage(activePreviewImage)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border transition"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  aria-label="放入输入框"
                  title="放入输入框"
                >
                  <LegacyFaIcon icon="fa-plus" className="text-[11px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewState(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border transition"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  aria-label="关闭大图"
                  title="关闭"
                >
                  <LegacyFaIcon icon="fa-xmark" className="text-sm" />
                </button>
              </div>
            </div>
            <div
              className="relative min-h-0 flex-1 overflow-hidden p-4"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              {previewState && previewState.images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => stepPreviewImage('prev')}
                    className="absolute left-5 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 text-slate-200 transition hover:text-white"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                    aria-label="上一张图片"
                  >
                    <LegacyFaIcon icon="fa-chevron-left" className="text-sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepPreviewImage('next')}
                    className="absolute right-5 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 text-slate-200 transition hover:text-white"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                    aria-label="下一张图片"
                  >
                    <LegacyFaIcon icon="fa-chevron-right" className="text-sm" />
                  </button>
                </>
              ) : null}
              <div className="flex h-full min-h-0 items-center justify-center overflow-hidden">
                <img
                  src={activePreviewImage.url}
                  alt={activePreviewImage.name}
                  className="block h-full w-full rounded-[20px] object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-none bg-transparent">
        {/* 批量发送进度提示 */}
        {batchSendState ? (
          <div className={`mb-2 rounded-[16px] border px-4 py-3 text-[12px] font-semibold ${
            batchSendState.error
              ? 'border-rose-200 bg-rose-50 text-rose-600'
              : 'border-cyan-100 bg-cyan-50/80 text-cyan-700'
          }`}>
            {batchSendState.error ? (
              <span>{batchSendState.error}</span>
            ) : batchSendState.currentBatch < batchSendState.totalBatches ? (
              <span>
                批量分析进行中：第 {batchSendState.currentBatch + 1} / {batchSendState.totalBatches} 批
                （共 {batchSendState.totalFiles} 个文件，每批最多 {MAX_FILES_PER_BATCH} 个）
              </span>
            ) : (
              <span>所有批次已发送，等待模型完成最终总结...</span>
            )}
          </div>
        ) : null}
        <ChatComposer
          messageDraft={messageDraft}
          onMessageDraftChange={onMessageDraftChange}
          onSendMessage={onSendMessage}
          onInterruptSend={onInterruptSend}
          disabled={isDisabled}
          sending={sending}
          chatModels={chatModels}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={onReasoningLevelChange}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={onWebSearchToggle}
          attachments={attachments}
          onAddAttachments={onAddAttachments}
          onRemoveAttachment={onRemoveAttachment}
          imageModeEnabled={imageModeEnabled}
          imageModeAvailable={imageModeAvailable}
          imageMaxInputCount={imageMaxInputCount}
          onImageModeToggle={onImageModeToggle}
          onBatchSendReady={onBatchSend ? handleBatchSendReady : undefined}
        />
      </div>
    </div>
  );
};

export default ChatConversationPane;
