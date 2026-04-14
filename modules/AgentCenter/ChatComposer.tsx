import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemPublicConfig } from '../../types';
import { uploadInternalAssetStream } from '../../services/internalApi';
import { resolveSessionReasoningLevel } from './chatReasoningDefaults.mjs';
import {
  extractFilesFromFolder,
  uploadFilesInBatches,
  FOLDER_WARN_THRESHOLD,
  MAX_FILES_PER_BATCH,
} from './folderZipUpload';
import FolderUploadCard from './FolderUploadCard';

export type ComposerAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'file';
  url?: string;
  mimeType?: string;
};

/**
 * 批量发送任务：文件夹/ZIP 解析后产生多批附件，调用方串行发送
 * batches[0] 先发，batches[N-1] 最后发（附带总结提示）
 */
export type BatchSendTask = {
  batches: ComposerAttachment[][];
  totalFiles: number;
  skippedCount: number;
  skippedReasons: string[];
};

export type FileUploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export type FolderCardFile = {
  relativePath: string;
  sizeBytes: number;
  status: FileUploadStatus;
};

export type FolderCard = {
  folderName: string;
  files: FolderCardFile[];
  uploadedCount: number;
  phase: 'uploading' | 'done' | 'error';
  batches: ComposerAttachment[][] | null;
  skippedCount: number;
  skippedReasons: string[];
  expanded: boolean;
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
  /** 文件夹/ZIP 解析完成后触发，调用方负责串行发送每批；返回 Promise 以便 Composer 保持 uploading 状态直到发送完成 */
  onBatchSendReady?: (task: BatchSendTask) => void | Promise<void>;
}

const buildAttachmentId = (kind: 'image' | 'file', name: string) =>
  `${kind}-${name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const CHAT_REUSE_IMAGE_MIME = 'application/x-meiao-chat-image';

const iconButtonClassName = (active: boolean, available: boolean) =>
  `group relative flex h-8 w-8 items-center justify-center rounded-full border transition ${
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
  onBatchSendReady,
}) => {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const folderAbortRef = useRef<AbortController | null>(null);
  const [folderCard, setFolderCard] = useState<FolderCard | null>(null);
  const uploading = attachmentUploading || folderCard?.phase === 'uploading';
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [reasoningPopoverOpen, setReasoningPopoverOpen] = useState(false);
  // 文件夹/ZIP 上传前的确认弹窗状态
  const [pendingBatchConfirm, setPendingBatchConfirm] = useState<{
    fileCount: number;
    batchCount: number;
    skippedCount: number;
    skippedReasons: string[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const selectableModels = chatModels.filter((item) => item && item.id);
  const selectedModelOption = selectableModels.find((item) => item.id === selectedModel) || selectableModels[0];
  const reasoningLevels = selectedModelOption?.reasoningLevels || [];
  const effectiveReasoningLevel = selectedModelOption?.supportsReasoningLevel
    ? resolveSessionReasoningLevel({
        reasoningLevels,
        requestedReasoningLevel: reasoningLevel,
      })
    : null;
  const supportsAnyAttachment = imageModeEnabled
    ? imageModeAvailable
    : Boolean(selectedModelOption?.supportsImageInput || selectedModelOption?.supportsFileInput);
  const folderReady = folderCard?.phase === 'done' && (folderCard.batches?.length ?? 0) > 0;
  const canSend = !disabled && !uploading && !sending && (Boolean(messageDraft.trim()) || attachments.length > 0 || folderReady);

  const attachmentHint = supportsAnyAttachment ? `上传图片或文件附件${imageModeEnabled ? `，当前最多 ${imageMaxInputCount} 张图` : ''}` : '当前模型不支持附件上传';
  const webHint = selectedModelOption?.supportsWebSearch
    ? webSearchEnabled ? '已开启联网搜索，再点一次关闭' : '开启联网搜索'
    : '当前模型不支持联网搜索';
  const reasoningHint = selectedModelOption?.supportsReasoningLevel
    ? '切换思考强度'
    : '当前模型不支持思考强度';

  // ─── 文件夹上传处理 ────────────────────────────────────────────────────────────

  const startFolderUpload = (files: ReturnType<typeof extractFilesFromFolder>['files'], skippedCount: number, skippedReasons: string[], folderName: string) => {
    const controller = new AbortController();
    folderAbortRef.current = controller;

    const initialFiles: FolderCardFile[] = files.map((f) => ({
      relativePath: f.relativePath,
      sizeBytes: f.file.size,
      status: 'pending',
    }));

    setFolderCard({
      folderName,
      files: initialFiles,
      uploadedCount: 0,
      phase: 'uploading',
      batches: null,
      skippedCount,
      skippedReasons,
      expanded: false,
    });
    setError('');

    void (async () => {
      try {
        const batches = await uploadFilesInBatches(
          files,
          (uploaded, total) => {
            setFolderCard((prev) => {
              if (!prev) return prev;
              const updatedFiles = prev.files.map((f, i) => {
                if (i < uploaded) return { ...f, status: 'done' as FileUploadStatus };
                if (i === uploaded) return { ...f, status: 'uploading' as FileUploadStatus };
                return f;
              });
              return { ...prev, files: updatedFiles, uploadedCount: uploaded };
            });
          },
          controller.signal,
        );
        setFolderCard((prev) => prev ? {
          ...prev,
          files: prev.files.map((f) => ({ ...f, status: 'done' })),
          uploadedCount: prev.files.length,
          phase: 'done',
          batches,
        } : null);
      } catch (err: any) {
        if (err?.message === 'INTERRUPTED' || err?.name === 'AbortError') {
          setFolderCard(null);
        } else {
          setFolderCard((prev) => prev ? { ...prev, phase: 'error' } : null);
          setError(err?.message || '文件夹上传失败，请重试。');
        }
      } finally {
        folderAbortRef.current = null;
      }
    })();
  };

  const handleFolderSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      event.target.value = '';
      return;
    }
    if (!onBatchSendReady) return;

    const extracted = extractFilesFromFolder(fileList);
    event.target.value = '';
    const { files, skippedCount, skippedReasons } = extracted;
    if (files.length === 0) {
      setError(`文件夹中没有可上传的文件。${skippedCount > 0 ? `（已跳过 ${skippedCount} 个不支持的文件）` : ''}`);
      return;
    }

    // 从第一个文件的相对路径提取文件夹名
    const folderName = files[0].relativePath.split('/')[0] || '文件夹';
    const batchCount = Math.ceil(files.length / MAX_FILES_PER_BATCH);

    if (files.length > FOLDER_WARN_THRESHOLD) {
      setPendingBatchConfirm({
        fileCount: files.length,
        batchCount,
        skippedCount,
        skippedReasons,
        onConfirm: () => {
          setPendingBatchConfirm(null);
          startFolderUpload(files, skippedCount, skippedReasons, folderName);
        },
        onCancel: () => setPendingBatchConfirm(null),
      });
    } else {
      startFolderUpload(files, skippedCount, skippedReasons, folderName);
    }
  };

  const handleDismissFolder = () => {
    folderAbortRef.current?.abort();
    folderAbortRef.current = null;
    setFolderCard(null);
  };

  const attachmentAccept = useMemo(() => {
    if (imageModeEnabled) return 'image/*';
    const accepts: string[] = [];
    if (selectedModelOption?.supportsImageInput) accepts.push('image/*');
    if (selectedModelOption?.supportsFileInput) accepts.push('.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.xml');
    return accepts.join(',') || 'image/*,.pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.json,.xml';
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
    setAttachmentUploading(true);
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
      setAttachmentUploading(false);
    }
  };

  const handleAttachmentSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    await handleFilesUpload(files);
    event.target.value = '';
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || sending || uploading || !supportsAnyAttachment) return;
    const clipboardItems = Array.from(event.clipboardData.items || []) as DataTransferItem[];
    const clipboardFiles = clipboardItems
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!clipboardFiles.length) return;
    event.preventDefault();
    await handleFilesUpload(clipboardFiles);
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
    const droppedFiles = Array.from(event.dataTransfer.files || []) as File[];
    if (droppedFiles.length === 0) return;

    await handleFilesUpload(droppedFiles);
  };

  return (
    <div className="rounded-[20px] border border-slate-200/85 bg-white/96 px-3 py-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[190px] rounded-full border border-slate-200/85 bg-slate-50/70 px-3 py-1.5">
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

        {/* 文件夹上传按钮 */}
        {onBatchSendReady ? (
          <button
            type="button"
            title="上传文件夹（批量分析）"
            aria-label="上传文件夹"
            disabled={disabled || uploading || sending}
            onClick={() => folderInputRef.current?.click()}
            className={iconButtonClassName(false, !disabled && !uploading && !sending)}
          >
            <i className="fas fa-folder-open text-[13px]" />
          </button>
        ) : null}

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
            <div className="absolute left-0 bottom-11 z-20 min-w-[110px] rounded-2xl border border-slate-200/90 bg-white/98 p-1 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
              {reasoningLevels.map((level) => {
                const active = effectiveReasoningLevel === level;
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

      {/* 文件夹上传卡片 */}
      {folderCard ? (
        <FolderUploadCard
          card={folderCard}
          onDismiss={handleDismissFolder}
          onToggleExpand={() => setFolderCard((c) => c ? { ...c, expanded: !c.expanded } : null)}
        />
      ) : null}

      <div
        className={`relative mt-2 rounded-[20px] transition ${dragActive ? 'bg-cyan-50/70 ring-2 ring-cyan-200/80' : ''}`}
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
          <div className="absolute bottom-3 left-3 right-16 z-10 flex max-h-[70px] flex-wrap gap-2 overflow-y-auto pr-1">
            {numberedAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex h-11 max-w-[210px] items-center gap-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/96 px-2 py-1.5 shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
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
          onPaste={handlePaste}
          placeholder={sending ? '消息发送中，请稍候' : imageModeEnabled ? '输入生图需求，引用图片时请直接说图1、图2、图3...' : '输入问题、需求或上传附件后发送'}
          disabled={disabled || sending}
          className={`min-h-[84px] w-full resize-none rounded-[18px] border border-slate-200/85 bg-slate-50/45 px-4 py-3 pr-14 text-[13px] leading-6 text-slate-800 outline-none transition focus:border-cyan-300 ${
            attachments.length > 0 ? 'pb-[4.5rem]' : ''
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
            className="absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-[13px] font-semibold text-white transition hover:bg-rose-600"
            aria-label="中断发送"
            title="中断发送"
          >
            <i className="fas fa-stop text-[11px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (folderCard?.phase === 'done' && folderCard.batches && onBatchSendReady) {
                const task: BatchSendTask = {
                  batches: folderCard.batches,
                  totalFiles: folderCard.files.length,
                  skippedCount: folderCard.skippedCount,
                  skippedReasons: folderCard.skippedReasons,
                };
                setFolderCard(null);
                void onBatchSendReady(task);
              } else {
                onSendMessage();
              }
            }}
            disabled={!canSend}
            className="absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-[13px] font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <i className="fas fa-arrow-up text-[12px]" />
          </button>
        )}
      </div>

      {error ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{error}</div> : null}

      {/* 普通附件 input */}
      <input
        key={`${selectedModel}-${attachmentAccept}`}
        ref={attachmentInputRef}
        type="file"
        accept={attachmentAccept}
        multiple
        className="hidden"
        onChange={handleAttachmentSelection}
      />

      {/* 文件夹 input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore directory 是非标准属性
        directory=""
        // @ts-ignore webkitdirectory 是非标准属性
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFolderSelection}
      />

      {/* 批量上传确认弹窗 */}
      {pendingBatchConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-6">
          <div className="w-full max-w-md rounded-[30px] border border-white/70 bg-white/96 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
            <h3 className="text-xl font-black text-slate-900">批量上传确认</h3>
            <div className="mt-3 space-y-2 text-sm font-medium leading-7 text-slate-600">
              <p>
                共检测到 <span className="font-black text-slate-900">{pendingBatchConfirm.fileCount}</span> 个可上传文件，
                将分 <span className="font-black text-slate-900">{pendingBatchConfirm.batchCount}</span> 批发送给模型分析。
              </p>
              {pendingBatchConfirm.skippedCount > 0 ? (
                <p className="text-slate-500">
                  已自动跳过 {pendingBatchConfirm.skippedCount} 个文件
                  {pendingBatchConfirm.skippedReasons.length > 0 ? `（${pendingBatchConfirm.skippedReasons.join('；')}）` : ''}。
                </p>
              ) : null}
              <p className="text-slate-500">
                每批最多 {MAX_FILES_PER_BATCH} 个文件，前几批会先发送分析，最后一批会附带综合总结请求。
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={pendingBatchConfirm.onCancel}
                className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-2.5 text-sm font-black text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={pendingBatchConfirm.onConfirm}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white"
              >
                开始上传并分析
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ChatComposer;
