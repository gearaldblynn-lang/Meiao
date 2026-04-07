import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemPublicConfig } from '../../types';
import { uploadInternalAssetStream } from '../../services/internalApi';

export type ComposerAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'file';
  url?: string;
  mimeType?: string;
};

interface Props {
  messageDraft: string;
  onMessageDraftChange: (value: string) => void;
  onSendMessage: () => void;
  onInterruptSend?: () => void;
  disabled?: boolean;
  sending?: boolean;
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
}

const buildAttachmentId = (kind: 'image' | 'file', name: string) =>
  `${kind}-${name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const CHAT_REUSE_IMAGE_MIME = 'application/x-meiao-chat-image';

const iconButtonClassName = (active: boolean, available: boolean) =>
  `group relative flex h-9 w-9 items-center justify-center rounded-full border transition ${
    available
      ? active
        ? 'border-cyan-300/90 bg-cyan-50 text-cyan-700'
        : 'border-slate-200/90 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
      : 'cursor-not-allowed border-slate-200/80 bg-slate-100 text-slate-300'
  }`;

const ChatComposer: React.FC<Props> = ({
  messageDraft,
  onMessageDraftChange,
  onSendMessage,
  onInterruptSend,
  disabled = false,
  sending = false,
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
}) => {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [reasoningPopoverOpen, setReasoningPopoverOpen] = useState(false);
  const selectableModels = chatModels.filter((item) => item && item.id);
  const selectedModelOption = selectableModels.find((item) => item.id === selectedModel) || selectableModels[0];
  const reasoningLevels = selectedModelOption?.reasoningLevels || [];
  const supportsAnyAttachment = imageModeEnabled
    ? imageModeAvailable
    : Boolean(selectedModelOption?.supportsImageInput || selectedModelOption?.supportsFileInput);
  const canSend = !disabled && !uploading && !sending && (Boolean(messageDraft.trim()) || attachments.length > 0);

  const attachmentHint = supportsAnyAttachment ? `上传图片或文件附件${imageModeEnabled ? `，当前最多 ${imageMaxInputCount} 张图` : ''}` : '当前模型不支持附件上传';
  const webHint = selectedModelOption?.supportsWebSearch
    ? webSearchEnabled ? '已开启联网搜索，再点一次关闭' : '开启联网搜索'
    : '当前模型不支持联网搜索';
  const reasoningHint = selectedModelOption?.supportsReasoningLevel
    ? '切换思考强度'
    : '当前模型不支持思考强度';

  const attachmentAccept = useMemo(() => {
    if (imageModeEnabled) return 'image/*';
    const accepts: string[] = [];
    if (selectedModelOption?.supportsImageInput) accepts.push('image/*');
    if (selectedModelOption?.supportsFileInput) accepts.push('.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xls', '.xlsx', '.pptx');
    return accepts.join(',') || 'image/*,.pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.pptx';
  }, [imageModeEnabled, selectedModelOption?.supportsFileInput, selectedModelOption?.supportsImageInput]);

  const numberedAttachments = attachments.map((attachment, index) => ({
    ...attachment,
    displayLabel: attachment.kind === 'image' ? `图${index + 1}` : attachment.name,
  }));

  useEffect(() => {
    if (!selectableModels.length) return;
    if (selectedModel && !selectableModels.some((item) => item.id === selectedModel)) {
      onModelChange(selectableModels[0].id);
    }
  }, [onModelChange, selectableModels, selectedModel]);

  const handleFilesUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const isImage = file.type.startsWith('image/');
          if (imageModeEnabled && !isImage) {
            throw new Error('生图模式只支持上传图片');
          }
          const result = await uploadInternalAssetStream({
            module: 'agent_chat',
            file,
            fileName: file.name,
          });
          return {
            id: buildAttachmentId(isImage ? 'image' : 'file', file.name),
            name: file.name,
            kind: isImage ? 'image' : 'file',
            url: result.fileUrl,
            mimeType: file.type || '',
          } satisfies ComposerAttachment;
        })
      );
      onAddAttachments(uploaded);
    } catch (requestError: any) {
      setError(requestError.message || '上传附件失败');
    } finally {
      setUploading(false);
    }
  };

  const handleAttachmentSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    await handleFilesUpload(files);
    event.target.value = '';
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (disabled || sending || uploading) return;
    const reusedImageRaw = event.dataTransfer.getData(CHAT_REUSE_IMAGE_MIME);
    if (reusedImageRaw) {
      try {
        const reusedImage = JSON.parse(reusedImageRaw);
        if (reusedImage?.url) {
          onAddAttachments([{
            id: buildAttachmentId('image', reusedImage.name || '复用图片'),
            name: reusedImage.name || '复用图片',
            kind: 'image',
            url: String(reusedImage.url),
            mimeType: String(reusedImage.mimeType || 'image/png'),
          }]);
          return;
        }
      } catch {}
    }
    const files = Array.from(event.dataTransfer.files || []) as File[];
    if (files.length > 0) {
      await handleFilesUpload(files);
    }
  };

  return (
    <div className="rounded-[22px] border border-slate-200/85 bg-white/96 p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] rounded-full border border-slate-200/85 bg-slate-50/70 px-3 py-1.5">
          <select
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            className="w-full cursor-pointer border-none bg-transparent text-[13px] font-semibold text-slate-800 outline-none"
          >
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          title={attachmentHint}
          aria-label={attachmentHint}
          disabled={!supportsAnyAttachment || disabled || uploading || sending}
          onClick={() => attachmentInputRef.current?.click()}
          className={iconButtonClassName(false, supportsAnyAttachment)}
        >
          <i className="fas fa-paperclip text-[13px]" />
        </button>

        <button
          type="button"
          title={imageModeAvailable ? (imageModeEnabled ? '已进入生图模式，再点一次退出' : '进入生图模式') : '当前智能体未启用生图模型'}
          aria-label={imageModeAvailable ? (imageModeEnabled ? '退出生图模式' : '进入生图模式') : '当前智能体未启用生图模型'}
          disabled={!imageModeAvailable || disabled || uploading || sending}
          onClick={onImageModeToggle}
          className={iconButtonClassName(imageModeEnabled, imageModeAvailable)}
        >
          <i className="fas fa-image text-[13px]" />
        </button>

        <button
          type="button"
          title={webHint}
          aria-label={webHint}
          disabled={!selectedModelOption?.supportsWebSearch || disabled || uploading || sending}
          onClick={onWebSearchToggle}
          className={iconButtonClassName(webSearchEnabled, Boolean(selectedModelOption?.supportsWebSearch))}
        >
          <i className="fas fa-globe text-[13px]" />
        </button>

        <div className="relative">
          <button
            type="button"
            title={reasoningHint}
            aria-label={reasoningHint}
            disabled={!selectedModelOption?.supportsReasoningLevel || disabled || uploading || sending}
            onClick={() => {
              if (!selectedModelOption?.supportsReasoningLevel) return;
              setReasoningPopoverOpen((value) => !value);
            }}
            className={iconButtonClassName(Boolean(reasoningLevel), Boolean(selectedModelOption?.supportsReasoningLevel))}
          >
            <i className="fas fa-brain text-[13px]" />
          </button>

          {reasoningPopoverOpen && selectedModelOption?.supportsReasoningLevel ? (
            <div className="absolute left-0 top-11 z-20 min-w-[110px] rounded-2xl border border-slate-200/90 bg-white/98 p-1 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
              {reasoningLevels.map((level) => {
                const active = (reasoningLevel || reasoningLevels[0] || '') === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      onReasoningLevelChange(level);
                      setReasoningPopoverOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{level}</span>
                    {active ? <i className="fas fa-check text-[11px]" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`relative mt-2.5 rounded-[24px] transition ${dragActive ? 'bg-cyan-50/70 ring-2 ring-cyan-200/80' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragActive(true);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        {attachments.length > 0 ? (
          <div className="absolute bottom-3 left-3 right-20 z-10 flex max-h-[76px] flex-wrap gap-2 overflow-y-auto pr-1">
            {numberedAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex h-12 max-w-[210px] items-center gap-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/96 px-2 py-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
              >
                {attachment.kind === 'image' && attachment.url ? (
                  <img src={attachment.url} alt={attachment.name} className="h-8 w-8 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <i className="fas fa-file-lines text-[12px]" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-600">
                  {attachment.kind === 'image' ? `${attachment.displayLabel} · ${attachment.name}` : attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  aria-label="移除附件"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          value={messageDraft}
          onChange={(event) => onMessageDraftChange(event.target.value)}
          placeholder={sending ? '消息发送中，请稍候' : imageModeEnabled ? '输入生图需求，引用图片时请直接说图1、图2、图3...' : '输入问题、需求或上传附件后发送'}
          disabled={disabled || sending}
          className={`min-h-[96px] w-full resize-none rounded-[20px] border border-slate-200/85 bg-slate-50/45 px-4 py-3 pr-16 text-[13px] leading-6 text-slate-800 outline-none transition focus:border-cyan-300 ${
            attachments.length > 0 ? 'pb-20' : ''
          }`}
        />

        {dragActive ? (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[18px] border border-dashed border-cyan-300 bg-cyan-50/86 text-[12px] font-semibold text-cyan-700">
            松开即可放入当前输入框
          </div>
        ) : null}

        {sending ? (
          <button
            type="button"
            onClick={onInterruptSend}
            className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-[13px] font-semibold text-white transition hover:bg-rose-600"
            aria-label="中断发送"
            title="中断发送"
          >
            <i className="fas fa-stop text-[11px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSendMessage}
            disabled={!canSend}
            className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-[13px] font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <i className="fas fa-arrow-up text-[12px]" />
          </button>
        )}
      </div>

      {error ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{error}</div> : null}

      <input
        key={`${selectedModel}-${attachmentAccept}`}
        ref={attachmentInputRef}
        type="file"
        accept={attachmentAccept}
        multiple
        className="hidden"
        onChange={handleAttachmentSelection}
      />
    </div>
  );
};

export default ChatComposer;
