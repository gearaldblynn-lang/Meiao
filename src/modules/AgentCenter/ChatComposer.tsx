import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemPublicConfig } from '../../types';
import { LegacyFaIcon } from '../../components/ui/workspacePrimitives';
import { Popover, PopoverContent, PopoverTrigger } from '../../shell/components/ui/popover';
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
  runSubmissionMode?: 'idle' | 'insert' | 'queue';
  queuedMessageCount?: number;
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
const REASONING_LEVEL_LABELS: Record<string, string> = {
  minimal: '极低',
  low: '低',
  medium: '中等',
  high: '高',
  xhigh: '极高',
};

const formatReasoningLevelLabel = (level: string | null | undefined) =>
  level ? (REASONING_LEVEL_LABELS[level] || level) : '';

const composerPopoverSurfaceClassName =
  'rounded-[18px] border border-white/70 bg-white/[0.88] p-2 shadow-[0_22px_70px_rgba(15,23,42,0.14)] backdrop-blur-2xl';

const capabilityIconClassName = (active: boolean, available: boolean) =>
  `group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition text-[13px] ${
    available
      ? active
        ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]'
        : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-default)] hover:text-[color:var(--text-primary)]'
      : 'cursor-not-allowed border-[color:var(--border-subtle)] bg-[color:var(--bg-base)] text-[color:var(--text-tertiary)]'
  }`;

const configRowClassName =
  'flex w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 text-left text-[13px] font-semibold transition hover:bg-slate-100/70';
const configOptionClassName =
  'block w-full rounded-[10px] px-3 py-1 text-left text-[11px] font-medium leading-4 transition hover:bg-white/55';

const IconTooltip = ({ label }: { label: string }) => (
  <span
    className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium opacity-0 shadow-[0_12px_32px_rgba(15,23,42,0.16)] transition group-hover:opacity-100 group-focus-visible:opacity-100"
    style={{ background: 'var(--text-primary)', color: 'var(--bg-base)' }}
  >
    {label}
  </span>
);

const ChatComposer: React.FC<Props> = ({
  messageDraft,
  onMessageDraftChange,
  onSendMessage,
  disabled = false,
  sending = false,
  runSubmissionMode = 'idle',
  queuedMessageCount = 0,
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
  const [configPane, setConfigPane] = useState<'main' | 'models' | 'reasoning'>('main');
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
  const imageAttachmentCount = attachments.filter((attachment) => attachment.kind === 'image').length;
  const folderReady = folderCard?.phase === 'done' && (folderCard.batches?.length ?? 0) > 0;
  const canSend = !disabled && !uploading && (Boolean(messageDraft.trim()) || attachments.length > 0 || folderReady);

  const attachmentHint = supportsAnyAttachment ? `上传图片或文件附件${imageModeEnabled ? `，当前最多 ${imageMaxInputCount} 张图` : ''}` : '当前模型不支持附件上传';
  const webHint = selectedModelOption?.supportsWebSearch
    ? webSearchEnabled ? '已开启联网搜索，再点一次关闭' : '开启联网搜索'
    : '当前模型不支持联网搜索';
  const selectedModelLabel = selectedModelOption?.label || '默认模型';
  const modelHint = `当前模型：${selectedModelLabel}`;
  const uploadStatusLabel = attachments.length > 0 ? `上传 · ${attachments.length}` : '上传';
  const configStatusLabel = `配置 · ${selectedModelLabel}`;
  const uploadAvailable = supportsAnyAttachment || Boolean(onBatchSendReady);
  const uploadHint = uploadAvailable ? '上传附件或文件夹' : '当前模型不支持附件上传';
  const folderHint = '上传文件夹（批量分析）';
  const imageModeHint = imageModeAvailable
    ? (imageModeEnabled ? '生图模式已开启' : '进入生图模式')
    : '当前智能体未启用生图模型';
  const webStatusLabel = selectedModelOption?.supportsWebSearch
    ? webSearchEnabled ? '联网开' : '联网关'
    : '联网不可用';
  const reasoningStatusLabel = selectedModelOption?.supportsReasoningLevel
    ? effectiveReasoningLevel ? `思考 ${formatReasoningLevelLabel(effectiveReasoningLevel)}` : '思考默认'
    : '思考不可用';
  const imageModeStatusLabel = !imageModeAvailable
    ? '生图不可用'
    : imageModeEnabled ? `生图开 · ${imageAttachmentCount}/${imageMaxInputCount}` : '生图关';
  const configHint = `${modelHint}；${webStatusLabel || '联网'}；${reasoningStatusLabel || '思考'}；${imageModeStatusLabel || '生图'}`;
  const sendButtonLabel = runSubmissionMode === 'queue' ? '加入下一轮' : runSubmissionMode === 'insert' ? '插入引导' : '发送';
  const runModeHint = runSubmissionMode === 'queue'
    ? queuedMessageCount > 0 ? `已有 ${queuedMessageCount} 条待发送，当前内容会替换下一轮` : '当前任务已进入执行阶段，发送后会排到下一轮'
    : runSubmissionMode === 'insert'
      ? '当前回复仍可调整，发送后会按新输入重新回答'
      : '';

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
            assetType: 'chat',
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
    if (disabled || uploading || !supportsAnyAttachment) return;
    const clipboardItems = Array.from(event.clipboardData.items || []) as DataTransferItem[];
    const clipboardFiles = clipboardItems
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!clipboardFiles.length) return;
    event.preventDefault();
    await handleFilesUpload(clipboardFiles);
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const shouldSendOnEnter = event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
    if (!shouldSendOnEnter) return;
    event.preventDefault();
    if (canSend) onSendMessage();
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (disabled || uploading) return;
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
    <div className="rounded-[18px] border px-3 py-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={uploadStatusLabel}
              aria-label={uploadHint}
              disabled={disabled || uploading}
              className={capabilityIconClassName(attachments.length > 0 || folderReady, uploadAvailable)}
            >
              <LegacyFaIcon icon="fa-plus" className="text-[14px]" />
              {(attachments.length > 0 || folderReady) ? <span className="agent-composer-status-dot absolute right-1 top-1 h-2 w-2 rounded-full bg-[color:var(--accent)]" /> : null}
              <IconTooltip label={uploadStatusLabel} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            sideOffset={10}
            avoidCollisions={false}
            align="start"
            className={`agent-composer-upload-menu ${composerPopoverSurfaceClassName} w-60`}
          >
            <button
              type="button"
              title={attachmentHint}
              aria-label={attachmentHint}
              disabled={!supportsAnyAttachment || disabled || uploading}
              onClick={() => attachmentInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: supportsAnyAttachment ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
            >
              <LegacyFaIcon icon="fa-paperclip" className="text-[13px]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">附件</span>
                <span className="block truncate text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{attachmentHint}</span>
              </span>
            </button>
            {onBatchSendReady ? (
              <button
                type="button"
                title={folderHint}
                aria-label={folderHint}
                disabled={disabled || uploading}
                onClick={() => folderInputRef.current?.click()}
                className="mt-1 flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: 'var(--text-primary)' }}
              >
                <LegacyFaIcon icon="fa-folder-open" className="text-[13px]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">文件夹</span>
                  <span className="block truncate text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{folderHint}</span>
                </span>
              </button>
            ) : null}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={capabilityIconClassName(webSearchEnabled || Boolean(reasoningLevel) || imageModeEnabled, !disabled && !uploading)}
              title={configHint}
              aria-label={configHint}
              disabled={disabled || uploading}
            >
              <LegacyFaIcon icon="fa-sliders" className="text-[14px]" />
              {(webSearchEnabled || Boolean(reasoningLevel) || imageModeEnabled) ? <span className="agent-composer-status-dot absolute right-1 top-1 h-2 w-2 rounded-full bg-[color:var(--accent)]" /> : null}
              <IconTooltip label={configStatusLabel} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            sideOffset={10}
            avoidCollisions={false}
            align="start"
            className={`agent-composer-config-menu ${composerPopoverSurfaceClassName} relative w-72 overflow-hidden`}
          >
            <div className={`agent-composer-config-main space-y-1 transition ${configPane !== 'main' ? 'pointer-events-none opacity-45 blur-[1.5px]' : ''}`}>
                <button
                  type="button"
                  className={configRowClassName}
                  onClick={() => setConfigPane(configPane === 'models' ? 'main' : 'models')}
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span className="inline-flex items-center gap-2">
                    <LegacyFaIcon icon="fa-sliders" className="text-[13px]" />
                    模型
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{selectedModelLabel}</span>
                </button>
                <button
                  type="button"
                  title={webHint}
                  aria-label={webHint}
                  aria-pressed={webSearchEnabled}
                  disabled={!selectedModelOption?.supportsWebSearch || disabled || uploading}
                  onClick={onWebSearchToggle}
                  className={configRowClassName}
                  style={{ color: selectedModelOption?.supportsWebSearch ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                >
                  <span className="inline-flex items-center gap-2">
                    <LegacyFaIcon icon="fa-globe" className="text-[13px]" />
                    联网
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{webStatusLabel.replace('联网', '') || webStatusLabel}</span>
                </button>
                <button
                  type="button"
                  className={configRowClassName}
                  onClick={() => setConfigPane(configPane === 'reasoning' ? 'main' : 'reasoning')}
                  disabled={!selectedModelOption?.supportsReasoningLevel}
                  style={{ color: selectedModelOption?.supportsReasoningLevel ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                >
                  <span className="inline-flex items-center gap-2">
                    <LegacyFaIcon icon="fa-brain" className="text-[13px]" />
                    思考
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{reasoningStatusLabel.replace('思考 ', '').replace('思考', '') || reasoningStatusLabel}</span>
                </button>
                <button
                  type="button"
                  title={imageModeHint}
                  aria-label={imageModeHint}
                  aria-pressed={imageModeEnabled}
                  disabled={!imageModeAvailable || disabled || uploading}
                  onClick={onImageModeToggle}
                  className={configRowClassName}
                  style={{ color: imageModeAvailable ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                >
                  <span className="inline-flex items-center gap-2">
                    <LegacyFaIcon icon="fa-image" className="text-[13px]" />
                    生图
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{imageModeStatusLabel.replace('生图', '') || imageModeStatusLabel}</span>
                </button>
              </div>
            {configPane === 'models' ? (
              <div className="agent-composer-config-popout agent-composer-config-detail agent-composer-config-models absolute inset-0 z-10 space-y-0.5 rounded-[18px] bg-white/[0.46] p-2 backdrop-blur-sm">
                <p className="px-2 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>模型</p>
                {selectableModels.map((model) => {
                  const active = model.id === selectedModel;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        onModelChange(model.id);
                        setConfigPane('main');
                      }}
                      className={configOptionClassName}
                      style={active
                        ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700 }
                        : { color: 'var(--text-secondary)' }}
                    >
                      {model.label}
                    </button>
                  );
                })}
              </div>
            ) : configPane === 'reasoning' ? (
              <div className="agent-composer-config-popout agent-composer-config-detail agent-composer-config-reasoning absolute inset-0 z-10 space-y-0.5 rounded-[18px] bg-white/[0.46] p-2 backdrop-blur-sm">
                <p className="px-2 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>思考强度</p>
                {selectedModelOption?.supportsReasoningLevel ? reasoningLevels.map((level) => {
                  const active = effectiveReasoningLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        onReasoningLevelChange(level);
                        setConfigPane('main');
                      }}
                      aria-pressed={active}
                      className={configOptionClassName}
                      style={active
                        ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700 }
                        : { color: 'var(--text-primary)' }}
                    >
                      {formatReasoningLevelLabel(level)}
                    </button>
                  );
                }) : (
                  <span className={configRowClassName} style={{ color: 'var(--text-tertiary)' }}>{reasoningStatusLabel}</span>
                )}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
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
                className="flex h-11 max-w-[210px] items-center gap-2 overflow-hidden rounded-2xl px-2 py-1.5"
                style={{ background: 'var(--bg-elevated)' }}
              >
                {attachment.kind === 'image' && attachment.url ? (
                  <img src={attachment.url} alt={attachment.name} className="h-8 w-8 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    <LegacyFaIcon icon="fa-file-lines" className="text-[12px]" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {attachment.kind === 'image' ? `${attachment.displayLabel} · ${attachment.name}` : attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition"
                  style={{ color: 'var(--text-tertiary)' }}
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
          onKeyDown={handleComposerKeyDown}
          placeholder={runSubmissionMode === 'queue' ? '当前任务执行中，可输入下一轮需求' : runSubmissionMode === 'insert' ? '继续输入可调整当前回复方向' : imageModeEnabled ? '输入生图需求，引用图片时请直接说图1、图2、图3...' : '输入问题、需求或上传附件后发送'}
          disabled={disabled}
          className={`min-h-[84px] w-full resize-none rounded-[18px] border px-4 py-3 pr-14 text-[13px] leading-6 outline-none transition ${
            attachments.length > 0 ? 'pb-[4.5rem]' : ''
          }`}
          style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
        />

        {dragActive ? (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[18px] border border-dashed border-cyan-300 bg-cyan-50/86 text-[12px] font-semibold text-cyan-700">
            松开即可放入当前输入框
          </div>
        ) : null}

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
          className={`group absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${
            runSubmissionMode === 'queue'
              ? 'bg-amber-500 hover:bg-amber-600'
              : runSubmissionMode === 'insert'
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-slate-800 hover:bg-slate-900'
          }`}
          aria-label={sendButtonLabel}
          title={runModeHint || sendButtonLabel}
        >
          <LegacyFaIcon icon={runSubmissionMode === 'queue' ? 'fa-clock' : runSubmissionMode === 'insert' ? 'fa-rotate-right' : 'fa-arrow-up'} className="text-[12px]" />
          <IconTooltip label={sendButtonLabel} />
        </button>
      </div>

      {error ? <div className="mt-3 rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div> : null}

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
