import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare2,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';

import type {
  SubtitleRemovalPixels,
  SubtitleRemovalRegion,
  SubtitleRemovalSourceDraft,
} from '../../types';
import {
  cancelMediaTranscodeSession,
  convertMediaTranscodeSession,
  createMediaTranscodeSession,
} from '../../services/mediaTranscodeClient';
import {
  pickSubtitlePreparationItems,
  summarizeSubtitleRemovalBatch,
} from '../../utils/subtitleRemovalBatch.mjs';
import {
  DEFAULT_SUBTITLE_REGION,
  subtitleRegionToPixels,
} from '../../utils/subtitleRemovalRegion.mjs';
import ConfirmDialog from './ConfirmDialog';
import SubtitleRemovalRegionDialog from './SubtitleRemovalRegionDialog';

type Phase = 'queued' | 'uploading' | 'analyzing' | 'transcoding' | 'ready' | 'submitting' | 'error';

export type SubtitleRemovalSubmitInput = {
  clientItemId: string;
  draft: SubtitleRemovalSourceDraft;
  subtitleRegionNormalized: SubtitleRemovalRegion;
  subtitleRegionPixels: SubtitleRemovalPixels;
};

export type SubtitleRemovalBatchLimits = {
  batchMaxItems: number;
  batchPrepConcurrency: number;
  batchSubmitConcurrency: number;
};

export type SubtitleRemovalSubmitOutcome = {
  clientItemId: string;
  ok: boolean;
  error?: string;
};

type BatchItem = {
  clientItemId: string;
  selected: boolean;
  file?: File;
  draft?: SubtitleRemovalSourceDraft;
  region: SubtitleRemovalRegion;
  regionMode: 'default' | 'custom';
  phase: Phase;
  uploadProgress: number;
  stageText: string;
  errorMessage?: string;
};

type Props = {
  draft: SubtitleRemovalSourceDraft | null;
  onDraftChange: (draft: SubtitleRemovalSourceDraft | null) => void;
  onSubmit: (inputs: SubtitleRemovalSubmitInput[]) => Promise<SubtitleRemovalSubmitOutcome[]> | SubtitleRemovalSubmitOutcome[];
  submitting?: boolean;
  featureAvailable?: boolean;
  limits?: Partial<SubtitleRemovalBatchLimits>;
};

const DEFAULT_LIMITS: SubtitleRemovalBatchLimits = {
  batchMaxItems: 10,
  batchPrepConcurrency: 2,
  batchSubmitConcurrency: 2,
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const formatDuration = (value: number) => {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = (safe % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
};

const formatBytes = (value: number) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes <= 0) return '大小未知';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const createStableId = (prefix: string) => globalThis.crypto?.randomUUID?.()
  || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const stageLabel = (item: BatchItem) => {
  if (item.phase === 'queued') return '等待处理';
  if (item.phase === 'uploading') return `上传中 ${item.uploadProgress}%`;
  if (item.phase === 'analyzing') return '正在分析';
  if (item.phase === 'transcoding') return '正在转码';
  if (item.phase === 'submitting') return '正在提交';
  if (item.phase === 'error') return '处理失败';
  return '可以提交';
};

const SubtitleRemovalWorkspace: React.FC<Props> = ({
  draft,
  onDraftChange,
  onSubmit,
  submitting = false,
  featureAvailable = true,
  limits,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const controllersRef = useRef(new Map<string, AbortController>());
  const sessionIdsRef = useRef(new Map<string, string>());
  const consumedDraftsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [editingItemId, setEditingItemId] = useState('');
  const [replaceTargetId, setReplaceTargetId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const batchMaxItems = boundedInteger(limits?.batchMaxItems, DEFAULT_LIMITS.batchMaxItems, 1, 20);
  const batchPrepConcurrency = boundedInteger(limits?.batchPrepConcurrency, DEFAULT_LIMITS.batchPrepConcurrency, 1, 4);

  const updateItem = useCallback((clientItemId: string, updater: (item: BatchItem) => BatchItem) => {
    setItems((current) => current.map((item) => (
      item.clientItemId === clientItemId ? updater(item) : item
    )));
  }, []);

  const cancelItemSession = useCallback(async (clientItemId: string) => {
    controllersRef.current.get(clientItemId)?.abort();
    controllersRef.current.delete(clientItemId);
    const sessionId = sessionIdsRef.current.get(clientItemId) || '';
    sessionIdsRef.current.delete(clientItemId);
    if (sessionId) await cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    const sessions = sessionIdsRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      sessions.forEach((sessionId) => {
        void cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
      });
      sessions.clear();
    };
  }, []);

  useEffect(() => {
    if (!draft?.sourceUrl) return;
    const identity = draft.draftNonce || draft.sourceUrl;
    if (consumedDraftsRef.current.has(identity)) return;
    consumedDraftsRef.current.add(identity);
    setItems((current) => {
      if (current.some((item) => item.draft?.sourceUrl === draft.sourceUrl)) return current;
      if (current.length >= batchMaxItems) {
        setBatchError(`一次最多上传 ${batchMaxItems} 个视频，请先提交或删除部分任务。`);
        return current;
      }
      return [...current, {
        clientItemId: createStableId('subtitle-card'),
        selected: true,
        draft,
        region: { ...DEFAULT_SUBTITLE_REGION },
        regionMode: 'default',
        phase: 'ready',
        uploadProgress: 100,
        stageText: '已从任务卡带入原视频',
      }];
    });
    onDraftChange(null);
  }, [batchMaxItems, draft, onDraftChange]);

  const prepareItem = useCallback(async (clientItemId: string, file: File) => {
    if (controllersRef.current.has(clientItemId)) return;
    const controller = new AbortController();
    controllersRef.current.set(clientItemId, controller);
    updateItem(clientItemId, (item) => ({
      ...item,
      phase: 'uploading',
      uploadProgress: 0,
      stageText: '正在上传原视频',
      errorMessage: undefined,
    }));
    try {
      const probe = await createMediaTranscodeSession({
        file,
        kind: 'video',
        profile: 'subtitle_removal',
        signal: controller.signal,
        onUploadProgress: (progress) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          updateItem(clientItemId, (item) => ({
            ...item,
            phase: progress.ratio >= 0.999 ? 'analyzing' : 'uploading',
            uploadProgress: Math.round(progress.ratio * 100),
            stageText: progress.ratio >= 0.999
              ? '上传完成，正在读取时长、分辨率和编码'
              : '正在上传原视频',
          }));
        },
      });
      if (!probe.sessionId) throw new Error('服务端未返回媒体处理会话');
      sessionIdsRef.current.set(clientItemId, probe.sessionId);
      if (probe.durationSeconds > 600) throw new Error('去字幕视频最长支持 600 秒，请先裁剪后重试');
      updateItem(clientItemId, (item) => ({
        ...item,
        phase: 'transcoding',
        uploadProgress: 100,
        stageText: '正在保留原画幅转换为 H.264 MP4',
      }));
      const result = await convertMediaTranscodeSession({
        sessionId: probe.sessionId,
        startSeconds: 0,
        endSeconds: probe.durationSeconds,
        module: 'video',
        signal: controller.signal,
      });
      sessionIdsRef.current.delete(clientItemId);
      if (!result.fileUrl) throw new Error('视频已处理，但未返回可用的托管素材');
      const nextDraft: SubtitleRemovalSourceDraft = {
        sourceUrl: result.fileUrl,
        assetId: result.assetId,
        fileName: result.fileName || file.name,
        mimeType: result.mimeType,
        durationSeconds: result.durationSeconds,
        sizeBytes: result.sizeBytes,
        width: Number(result.width || probe.width || 0),
        height: Number(result.height || probe.height || 0),
        videoCodec: result.videoCodec || probe.videoCodec,
        transcoded: result.transcoded,
        draftNonce: createStableId('subtitle'),
      };
      if (!nextDraft.width || !nextDraft.height) throw new Error('无法读取处理后视频分辨率');
      updateItem(clientItemId, (item) => ({
        ...item,
        draft: nextDraft,
        phase: 'ready',
        uploadProgress: 100,
        stageText: result.transcoded
          ? '已保留原画幅转换为 H.264 MP4'
          : '原视频已是兼容格式，未重复转码',
        errorMessage: undefined,
      }));
    } catch (error) {
      const cancelled = controller.signal.aborted
        || (error as { code?: string })?.code === 'media_transcode_cancelled';
      const sessionId = sessionIdsRef.current.get(clientItemId) || '';
      sessionIdsRef.current.delete(clientItemId);
      if (sessionId) await cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
      if (!mountedRef.current || cancelled) return;
      updateItem(clientItemId, (item) => ({
        ...item,
        phase: 'error',
        stageText: '视频暂时无法处理',
        errorMessage: error instanceof Error ? error.message : '视频处理失败，请重试',
      }));
    } finally {
      if (controllersRef.current.get(clientItemId) === controller) {
        controllersRef.current.delete(clientItemId);
      }
    }
  }, [updateItem]);

  useEffect(() => {
    if (!featureAvailable) return;
    const nextItems = pickSubtitlePreparationItems(
      items,
      Array.from(controllersRef.current.keys()),
      batchPrepConcurrency,
    );
    nextItems.forEach((item) => {
      if (item.file) void prepareItem(item.clientItemId, item.file);
      else updateItem(item.clientItemId, (current) => ({
        ...current,
        phase: 'error',
        errorMessage: '找不到待处理的视频文件',
      }));
    });
  }, [batchPrepConcurrency, featureAvailable, items, prepareItem, updateItem]);

  const appendFiles = useCallback((selectedFiles: File[]) => {
    if (!featureAvailable || selectedFiles.length === 0) return;
    if (items.length + selectedFiles.length > batchMaxItems) {
      setBatchError(`一次最多上传 ${batchMaxItems} 个视频，本次选择了 ${selectedFiles.length} 个。`);
      return;
    }
    setBatchError('');
    const nextItems = selectedFiles.map<BatchItem>((file) => {
      const validVideo = file.type.startsWith('video/');
      return {
        clientItemId: createStableId('subtitle-item'),
        selected: validVideo,
        file,
        region: { ...DEFAULT_SUBTITLE_REGION },
        regionMode: 'default',
        phase: validVideo ? 'queued' : 'error',
        uploadProgress: 0,
        stageText: validVideo ? '等待上传' : '文件格式不支持',
        ...(validVideo ? {} : { errorMessage: '请选择视频文件' }),
      };
    });
    setItems((current) => [...current, ...nextItems]);
  }, [batchMaxItems, featureAvailable, items.length]);

  const removeItem = useCallback(async (clientItemId: string) => {
    await cancelItemSession(clientItemId);
    setItems((current) => current.filter((item) => item.clientItemId !== clientItemId));
    if (editingItemId === clientItemId) setEditingItemId('');
  }, [cancelItemSession, editingItemId]);

  const replaceItem = useCallback(async (clientItemId: string, file: File) => {
    await cancelItemSession(clientItemId);
    const validVideo = file.type.startsWith('video/');
    updateItem(clientItemId, () => ({
      clientItemId,
      selected: validVideo,
      file,
      region: { ...DEFAULT_SUBTITLE_REGION },
      regionMode: 'default',
      phase: validVideo ? 'queued' : 'error',
      uploadProgress: 0,
      stageText: validVideo ? '等待上传' : '文件格式不支持',
      ...(validVideo ? {} : { errorMessage: '请选择视频文件' }),
    }));
  }, [cancelItemSession, updateItem]);

  const retryItem = useCallback((clientItemId: string) => {
    updateItem(clientItemId, (item) => item.file ? {
      ...item,
      selected: true,
      draft: undefined,
      phase: 'queued',
      uploadProgress: 0,
      stageText: '等待重新上传',
      errorMessage: undefined,
    } : item.draft ? {
      ...item,
      selected: true,
      phase: 'ready',
      errorMessage: undefined,
    } : item);
  }, [updateItem]);

  const summary = useMemo(() => summarizeSubtitleRemovalBatch(items), [items]);
  const readySelectedItems = useMemo(() => items.filter((item) => (
    item.selected
    && item.phase === 'ready'
    && Boolean(item.draft?.sourceUrl)
  )), [items]);
  const editingItem = items.find((item) => item.clientItemId === editingItemId && item.draft) || null;

  const handleSubmit = async () => {
    if (submitLockRef.current || submitting || localSubmitting || readySelectedItems.length === 0) return;
    submitLockRef.current = true;
    setConfirmOpen(false);
    setLocalSubmitting(true);
    const submittingIds = new Set(readySelectedItems.map((item) => item.clientItemId));
    setItems((current) => current.map((item) => submittingIds.has(item.clientItemId)
      ? { ...item, phase: 'submitting', stageText: '正在创建后台任务', errorMessage: undefined }
      : item));
    try {
      const submitInputs = readySelectedItems.map((item) => {
        if (!item.draft) throw new Error('视频还未准备完成');
        return {
          clientItemId: item.clientItemId,
          draft: item.draft,
          subtitleRegionNormalized: item.region,
          subtitleRegionPixels: subtitleRegionToPixels(item.region, item.draft.width, item.draft.height),
        };
      });
      const outcomes = await onSubmit(submitInputs);
      const outcomeById = new Map(outcomes.map((outcome) => [outcome.clientItemId, outcome]));
      const succeededIds = new Set<string>();
      const failedById = new Map<string, string>();
      submitInputs.forEach(({ clientItemId }) => {
        const outcome = outcomeById.get(clientItemId);
        if (outcome?.ok) succeededIds.add(clientItemId);
        else failedById.set(clientItemId, outcome?.error || '去字幕任务提交失败');
      });
      setItems((current) => current
        .filter((item) => !succeededIds.has(item.clientItemId))
        .map((item) => failedById.has(item.clientItemId) ? {
          ...item,
          phase: 'error',
          stageText: '任务提交失败',
          errorMessage: failedById.get(item.clientItemId),
        } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : '去字幕任务提交失败';
      setItems((current) => current.map((item) => submittingIds.has(item.clientItemId) ? {
        ...item,
        phase: 'error',
        stageText: '任务提交失败',
        errorMessage: message,
      } : item));
    } finally {
      submitLockRef.current = false;
      setLocalSubmitting(false);
    }
  };

  const clearAll = async () => {
    const itemIds = items.map((item) => item.clientItemId);
    await Promise.all(itemIds.map((clientItemId) => cancelItemSession(clientItemId)));
    setItems([]);
    setEditingItemId('');
    setBatchError('');
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 pb-10 pt-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>视频去字幕</h2>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            批量上传视频，系统默认选择画面底部 30%；特殊视频可单独点开调整。
          </p>
        </div>
        {items.length > 0 ? (
          <button type="button" onClick={() => void clearAll()} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <Trash2 size={13} /> 清空任务栏
          </button>
        ) : null}
      </div>

      {!featureAvailable ? (
        <div className="flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>去字幕功能暂未开放，请联系管理员。</p>
        </div>
      ) : null}

      <button
        type="button"
        disabled={!featureAvailable || items.length >= batchMaxItems}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); }}
        onDrop={(event) => {
          event.preventDefault();
          appendFiles(Array.from(event.dataTransfer.files || []));
        }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed px-6 text-center disabled:cursor-not-allowed disabled:opacity-45 ${items.length > 0 ? 'min-h-[120px]' : 'min-h-[260px]'}`}
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          {items.length > 0 ? <Plus size={19} /> : <Upload size={20} />}
        </span>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {items.length > 0 ? '继续添加视频' : '批量上传需要去字幕的视频'}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          支持拖放，一次最多上传 {batchMaxItems} 个；单个视频最长 600 秒，不受短视频生成 15 秒限制；系统会逐个分析格式并按需转码。
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          appendFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          if (file && replaceTargetId) void replaceItem(replaceTargetId, file);
          event.target.value = '';
          setReplaceTargetId('');
        }}
      />

      {batchError ? (
        <div className="flex items-start gap-2 rounded-2xl border px-4 py-3 text-[11px]" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {batchError}
        </div>
      ) : null}

      {items.length > 0 ? (
        <section aria-label="去字幕批量任务" className="overflow-hidden rounded-3xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>批量任务</h3>
              <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>点击任意已就绪视频，单独调整它的字幕区域。</p>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{items.length}/{batchMaxItems}</span>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {items.map((item, index) => {
              const itemDraft = item.draft;
              const itemReady = item.phase === 'ready' && Boolean(itemDraft?.sourceUrl);
              return (
                <div key={item.clientItemId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    aria-pressed={item.selected}
                    aria-label={`${item.selected ? '取消选择' : '选择'} ${itemDraft?.fileName || item.file?.name || `视频 ${index + 1}`}`}
                    onClick={() => updateItem(item.clientItemId, (current) => ({ ...current, selected: !current.selected }))}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: item.selected ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: item.selected ? 'var(--accent)' : 'var(--text-tertiary)' }}
                  >
                    {item.selected ? <CheckSquare2 size={16} /> : <Square size={16} />}
                  </button>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                    <Film size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="max-w-[360px] truncate text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{itemDraft?.fileName || item.file?.name || `视频 ${index + 1}`}</span>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-medium" style={{ background: item.regionMode === 'custom' ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: item.regionMode === 'custom' ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                        {item.regionMode === 'custom' ? '已调整' : '默认区域'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {itemDraft ? <span>{formatDuration(itemDraft.durationSeconds)}</span> : null}
                      <span>{formatBytes(itemDraft?.sizeBytes || item.file?.size || 0)}</span>
                      {itemDraft?.width && itemDraft?.height ? <span>{itemDraft.width}×{itemDraft.height}</span> : null}
                      {itemDraft?.videoCodec ? <span>{itemDraft.videoCodec.toUpperCase()}</span> : null}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: item.phase === 'error' ? 'var(--danger)' : itemReady ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {itemReady ? <CheckCircle2 size={12} /> : ['queued', 'uploading', 'analyzing', 'transcoding', 'submitting'].includes(item.phase) ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} />}
                      <span>{item.errorMessage || item.stageText || stageLabel(item)}</span>
                    </div>
                    {item.phase === 'uploading' ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
                        <div className="h-full rounded-full transition-[width]" style={{ width: `${item.uploadProgress}%`, background: 'var(--accent)' }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                    <button
                      type="button"
                      disabled={!itemReady || submitting || localSubmitting}
                      onClick={() => setEditingItemId(item.clientItemId)}
                      className="flex items-center gap-1 rounded-full px-3 py-2 text-[10px] font-medium disabled:opacity-35"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Settings2 size={12} /> 调整区域
                    </button>
                    {item.phase === 'error' ? (
                      <button type="button" onClick={() => retryItem(item.clientItemId)} className="flex items-center gap-1 rounded-full px-3 py-2 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                        <RefreshCw size={12} /> 重试
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setReplaceTargetId(item.clientItemId);
                        replaceInputRef.current?.click();
                      }}
                      className="rounded-full px-3 py-2 text-[10px] font-medium"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      替换
                    </button>
                    <button type="button" onClick={() => void removeItem(item.clientItemId)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} aria-label="删除视频任务">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {items.length > 0 ? (
        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-3xl border p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between" style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, transparent)', borderColor: 'var(--border-subtle)', backdropFilter: 'blur(20px)' }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            <span>已选择 {summary.selectedCount} 个</span>
            <span style={{ color: 'var(--accent)' }}>可提交 {summary.readySelectedCount} 个</span>
            <span style={{ color: summary.errorCount ? 'var(--danger)' : 'var(--text-tertiary)' }}>异常 {summary.errorCount} 个</span>
            <span>总时长 {formatDuration(summary.totalSelectedDurationSeconds)}</span>
          </div>
          <button
            type="button"
            disabled={!featureAvailable || summary.readySelectedCount === 0 || submitting || localSubmitting}
            onClick={() => setConfirmOpen(true)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {submitting || localSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            批量开始去字幕
          </button>
        </div>
      ) : null}

      <SubtitleRemovalRegionDialog
        key={editingItem?.draft?.draftNonce || 'closed'}
        item={editingItem?.draft ? { draft: editingItem.draft, region: editingItem.region } : null}
        onCancel={() => setEditingItemId('')}
        onSave={(region) => {
          if (!editingItem) return;
          updateItem(editingItem.clientItemId, (item) => ({ ...item, region, regionMode: 'custom' }));
          setEditingItemId('');
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="确认批量开始去字幕"
        message={`本次将创建 ${readySelectedItems.length} 个独立付费任务，总时长 ${formatDuration(readySelectedItems.reduce((sum, item) => sum + Number(item.draft?.durationSeconds || 0), 0))}。异常或未就绪视频不会提交。`}
        confirmText={`确认提交 ${readySelectedItems.length} 个`}
        onConfirm={() => void handleSubmit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default SubtitleRemovalWorkspace;
