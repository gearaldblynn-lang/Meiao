import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../types';
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
  'inline-flex items-center rounded-full border border-slate-200/85 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-500';

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
      <div className="space-y-3">
        {isPending ? (
          <div className="rounded-[18px] border border-cyan-100 bg-[linear-gradient(180deg,rgba(236,254,255,0.92),rgba(255,255,255,0.96))] px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600">
                <i className="fas fa-spinner animate-spin text-[11px]" />
              </span>
              <div>
                <p className="text-[12px] font-black text-slate-900">{message.content || '处理中'}</p>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">{getProgressStageLabel(message)}</p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className={`rounded-full px-2.5 py-1 font-medium ${isPending ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>
            {isPending ? getProgressBadgeText(message) : `已生成 ${Math.max(resultCount, imageAttachments.length || 1)} 张图片`}
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
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                title={`${image.label}${image.role ? ` · ${image.role}` : ''}`}
              >
                参考图 {image.label}{image.role ? ` · ${image.role}` : ''}
              </button>
            ))
          ) : !isPending ? (
            <span>{referenceText}</span>
          ) : null}
        </div>
        {imageAttachments.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {imageAttachments.map((attachment, index) => (
              <div
                key={`${message.id}-${attachment.name}-${index}`}
                className="group relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-2 text-left transition hover:border-slate-300/90"
              >
                <button type="button" onClick={() => openPreview(previewImages, index)} className="block w-full">
                  <img
                    src={attachment.url}
                    alt={attachment.name}
                    className="h-auto w-full rounded-[14px] object-cover"
                    draggable
                    onDragStart={(event) => beginDragReuseImage(event, previewImages[index])}
                  />
                </button>
                <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-[14px] bg-slate-950/0 px-3 py-2 text-[11px] text-white opacity-0 transition group-hover:bg-slate-950/44 group-hover:opacity-100">
                  点击查看大图
                </span>
                <span className="absolute right-4 top-4 flex gap-2 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      reuseImage(previewImages[index]);
                    }}
                    className="flex h-9 min-w-9 items-center justify-center rounded-full border border-white/18 bg-slate-950/56 px-2 text-white shadow-[0_12px_28px_rgba(15,23,42,0.28)] transition hover:bg-slate-950/68"
                    aria-label="放入当前输入框"
                    title="放入当前输入框"
                  >
                    <i className="fas fa-plus text-[12px]" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadImage(previewImages[index]);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/18 bg-slate-950/56 text-white shadow-[0_12px_28px_rgba(15,23,42,0.28)] transition hover:bg-slate-950/68"
                    aria-label="下载生成图片"
                    title="下载图片"
                  >
                    <i className="fas fa-download text-[12px]" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
            <button
              type="button"
              onClick={() => toggleSummary(message.id)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={summaryExpanded}
            >
              <p className="text-[12px] font-black text-slate-700">结果总结</p>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                {summaryExpanded ? '收起' : '展开'}
                <i className={`fas fa-chevron-${summaryExpanded ? 'up' : 'down'} text-[10px]`} />
              </span>
            </button>
            {summaryExpanded ? (
              <p className="mt-1.5 select-text whitespace-pre-wrap text-[12px] leading-6 text-slate-600">{message.content}</p>
            ) : null}
          </div>
        ) : null}
        {retrievalSummary.length > 0 ? (
          <div className="rounded-[16px] border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
            <button
              type="button"
              onClick={() => toggleReferenceRules(message.id)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={referenceRulesExpanded}
            >
              <p className="text-[12px] font-black text-emerald-800">本次参考规则</p>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                {referenceRulesExpanded ? '收起' : '展开'}
                <i className={`fas fa-chevron-${referenceRulesExpanded ? 'up' : 'down'} text-[10px]`} />
              </span>
            </button>
            {referenceRulesExpanded ? (
              <div className="mt-2 space-y-2">
                {retrievalSummary.map((item, index) => (
                  <div key={`${message.id}-rule-${index}`} className="rounded-[12px] bg-white/78 px-3 py-2">
                    <p className="text-[11px] font-black text-slate-700">{item.documentTitle || `规则${index + 1}`}</p>
                    <p className="mt-1 select-text text-[11px] leading-5 text-slate-600">{item.preview || '已命中相关规则'}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-[12px] leading-6 text-slate-500">可继续直接描述你要修改的地方，我会基于上一张结果继续调整。</p>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-[30px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,252,0.9))] p-3 shadow-[0_18px_46px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:p-4">
      {!hideSessionHeader ? (
        <div className="rounded-[22px] border border-slate-200/80 bg-white/92 px-4 py-3 shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <AgentAvatar
                name={selectedAgent?.name || '智能体'}
                iconUrl={selectedAgent?.iconUrl || undefined}
                avatarPreset={selectedAgent?.avatarPreset || undefined}
                className="h-11 w-11 rounded-[15px] text-sm shadow-[0_8px_18px_rgba(56,189,248,0.14)]"
              />
              <div className="min-w-0">
                <p className="text-[15px] font-black tracking-[-0.02em] text-slate-950">{selectedAgent?.name || '智能体'}</p>
                <p className="mt-0.5 text-[12px] font-medium leading-5 text-slate-500">当前会话 · {focusedSessionTitle}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={metaTagClassName} style={{ letterSpacing: '0.08em' }}>
                {selectedModelOption?.label || '默认模型'}
              </span>
              {galleryImages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowGallery(true)}
                  className={`${metaTagClassName} transition hover:border-slate-300 hover:text-slate-700`}
                >
                  本次会话图库
                </button>
              ) : null}
              <span className={metaTagClassName}>附件 {attachments.length} 个</span>
              {imageModeAvailable ? (
                <span className={`${metaTagClassName} ${imageModeEnabled ? 'text-cyan-700' : ''}`}>
                  {imageModeEnabled ? '生图模式' : '对话模式'}
                </span>
              ) : null}
              {selectedModelOption?.supportsWebSearch && webSearchEnabled ? (
                <span className={`${metaTagClassName} text-emerald-600`}>联网</span>
              ) : null}
              {selectedModelOption?.supportsReasoningLevel && reasoningLevel ? (
                <span className={metaTagClassName}>思考 {reasoningLevel}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-slate-200/75 bg-white/84 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
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
                      <span className="text-[11px] font-medium text-slate-500">{isUser ? (currentUser?.username || '我') : '智能体'}</span>
                      <span className="text-[10px] font-normal text-slate-300">
                        {new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>

                    <div
                      className={`w-full rounded-[18px] px-3.5 py-2.5 text-[13px] leading-6 shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${
                        isUser
                          ? 'bg-[#2f394b] text-white'
                          : 'border border-slate-200/80 bg-white text-slate-700'
                      }`}
                    >
                      {imageGenerationMessage ? renderImageGenerationMessage(message) : progressOnlyMessage ? (
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600">
                            <i className="fas fa-spinner animate-spin text-[11px]" />
                          </span>
                          <div>
                            <p className="text-[12px] font-black text-slate-900">{message.content || '处理中'}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-slate-500">{getProgressStageLabel(message)}</p>
                          </div>
                        </div>
                      ) : (() => {
                          const handoff = !message.metadata?.pending ? parseHandoffBlock(message.content) : null;
                          const displayContent = handoff ? stripHandoffBlock(message.content) : message.content;
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
                                    <i className="fas fa-arrow-right text-[10px]" />
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
                                className={`group flex items-center gap-2 rounded-2xl px-2 py-1 text-left ${isUser ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}
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
                                  className={`flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100 ${isUser ? 'bg-white/20 text-white' : 'bg-white text-slate-500'}`}
                                  aria-label="放入当前输入框"
                                  title="放入当前输入框"
                                >
                                  <i className="fas fa-plus text-[10px]" />
                                </button>
                              </div>
                            ) : (
                              <span
                                key={`${message.id}-${attachment.name}-${index}`}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                  isUser ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                <span className="select-text">{attachment.name}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {!isUser && message.metadata?.fallbackFrom ? (
                      <p className="mt-1 text-[11px] font-medium text-amber-500">
                        <i className="fas fa-exclamation-triangle mr-1 text-[10px]" />
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
            className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/12 shadow-[0_30px_80px_rgba(15,23,42,0.5)]"
            style={{ backgroundColor: 'rgba(2, 6, 23, 0.18)', backdropFilter: 'blur(24px)' }}
          >
            <div
              className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6"
              style={{ backgroundColor: 'rgba(2, 6, 23, 0.14)' }}
            >
              <div>
                <p className="text-[18px] font-black text-white">本次会话图库</p>
                <p className="mt-1 text-[12px] text-slate-400">删除当前会话后，这里的图片会一起清除。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGallery(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/14 text-slate-200 transition hover:text-white"
                style={{ backgroundColor: 'rgba(15, 23, 42, 0.2)' }}
                aria-label="关闭图库"
              >
                <i className="fas fa-xmark text-sm" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
              style={{ backgroundColor: 'rgba(2, 6, 23, 0.1)' }}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {galleryImages.map((image) => (
                  <div
                    key={image.id}
                    className="group overflow-hidden rounded-[22px] border border-white/10 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
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
                        <p className="truncate text-[12px] font-semibold text-white">{image.name}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{new Date(image.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => reuseImage(image)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/14 text-white opacity-0 transition group-hover:opacity-100"
                          style={{ backgroundColor: 'rgba(15, 23, 42, 0.22)' }}
                          aria-label="放入当前输入框"
                          title="放入当前输入框"
                        >
                          <i className="fas fa-plus text-[12px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadImage(image)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/14 text-white opacity-0 transition group-hover:opacity-100"
                          style={{ backgroundColor: 'rgba(15, 23, 42, 0.22)' }}
                          aria-label="下载图片"
                          title="下载图片"
                        >
                          <i className="fas fa-download text-[12px]" />
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
            className="relative mx-auto flex h-full w-full max-w-[min(72vw,700px)] min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/12 shadow-[0_30px_90px_rgba(15,23,42,0.58)]"
            style={{ backgroundColor: 'rgba(2, 6, 23, 0.16)', backdropFilter: 'blur(24px)' }}
          >
            <div
              className="flex items-center justify-between border-b border-white/10 px-4 py-3"
              style={{ backgroundColor: 'rgba(2, 6, 23, 0.12)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-white">{activePreviewImage.name}</p>
                <p className="mt-1 text-[10px] text-slate-400">{new Date(activePreviewImage.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
              </div>
              <div className="flex items-center gap-2">
                {previewState && previewState.images.length > 1 ? (
                  <span
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-300"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                  >
                    {previewState.index + 1} / {previewState.images.length}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => downloadImage(activePreviewImage)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-white transition"
                  style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                  aria-label="下载图片"
                  title="下载图片"
                >
                  <i className="fas fa-download text-[11px]" />
                </button>
                <button
                  type="button"
                  onClick={() => reuseImage(activePreviewImage)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-200/40 text-cyan-100 transition"
                  style={{ backgroundColor: 'rgba(8, 145, 178, 0.16)' }}
                  aria-label="放入输入框"
                  title="放入输入框"
                >
                  <i className="fas fa-plus text-[11px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewState(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/18 text-slate-100 transition"
                  style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                  aria-label="关闭大图"
                  title="关闭"
                >
                  <i className="fas fa-xmark text-sm" />
                </button>
              </div>
            </div>
            <div
              className="relative min-h-0 flex-1 overflow-hidden p-4"
              style={{ backgroundColor: 'rgba(2, 6, 23, 0.08)' }}
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
                    <i className="fas fa-chevron-left text-sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepPreviewImage('next')}
                    className="absolute right-5 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 text-slate-200 transition hover:text-white"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.18)' }}
                    aria-label="下一张图片"
                  >
                    <i className="fas fa-chevron-right text-sm" />
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
