import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Film,
  Loader2,
  Scissors,
  Upload,
  X,
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
  DEFAULT_SUBTITLE_REGION,
  subtitleRegionToPixels,
} from '../../utils/subtitleRemovalRegion.mjs';
import SubtitleRegionEditor from './SubtitleRegionEditor';

type Phase = 'idle' | 'uploading' | 'analyzing' | 'transcoding' | 'ready' | 'submitting' | 'error';

export type SubtitleRemovalSubmitInput = {
  draft: SubtitleRemovalSourceDraft;
  subtitleRegionNormalized: SubtitleRemovalRegion;
  subtitleRegionPixels: SubtitleRemovalPixels;
};

type Props = {
  draft: SubtitleRemovalSourceDraft | null;
  onDraftChange: (draft: SubtitleRemovalSourceDraft | null) => void;
  onSubmit: (input: SubtitleRemovalSubmitInput) => Promise<void> | void;
  submitting?: boolean;
  featureAvailable?: boolean;
};

const formatDuration = (value: number) => {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = (safe % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
};

const formatBytes = (value: number) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const createDraftNonce = () => globalThis.crypto?.randomUUID?.()
  || `subtitle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const SubtitleRemovalWorkspace: React.FC<Props> = ({
  draft,
  onDraftChange,
  onSubmit,
  submitting = false,
  featureAvailable = true,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef('');
  const activeRequestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const [phase, setPhase] = useState<Phase>(draft ? 'ready' : 'idle');
  const [region, setRegion] = useState<SubtitleRemovalRegion>({ ...DEFAULT_SUBTITLE_REGION });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stageText, setStageText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const cancelUnfinishedSession = async () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = '';
    if (sessionId) {
      await cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current?.abort();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = '';
      if (sessionId) void cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    setRegion({ ...DEFAULT_SUBTITLE_REGION });
    if (draft) {
      setPhase('ready');
      setErrorMessage('');
      setStageText(draft.transcoded === true
        ? '已保留原画幅转换为 H.264 MP4'
        : draft.transcoded === false
          ? '原视频已是兼容格式，未重复转码'
          : '已从任务卡带入原视频');
    } else if (!sessionIdRef.current) {
      setPhase('idle');
      setStageText('');
    }
  }, [draft?.sourceUrl]);

  const pixels = useMemo<SubtitleRemovalPixels | null>(() => {
    if (!draft?.width || !draft?.height) return null;
    try {
      return subtitleRegionToPixels(region, draft.width, draft.height);
    } catch {
      return null;
    }
  }, [draft?.height, draft?.width, region]);

  const handleFile = async (file: File) => {
    if (!featureAvailable) return;
    if (!file.type.startsWith('video/')) {
      setPhase('error');
      setErrorMessage('请选择视频文件');
      return;
    }
    await cancelUnfinishedSession();
    onDraftChange(null);
    setRegion({ ...DEFAULT_SUBTITLE_REGION });
    setUploadProgress(0);
    setStageText('正在上传原视频');
    setErrorMessage('');
    setPhase('uploading');
    const controller = new AbortController();
    activeRequestRef.current = controller;
    try {
      const probe = await createMediaTranscodeSession({
        file,
        kind: 'video',
        profile: 'subtitle_removal',
        signal: controller.signal,
        onUploadProgress: (progress) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          setUploadProgress(Math.round(progress.ratio * 100));
          if (progress.ratio >= 0.999) {
            setPhase('analyzing');
            setStageText('上传完成，正在读取时长、分辨率和编码');
          }
        },
      });
      if (!probe.sessionId) throw new Error('服务端未返回媒体处理会话');
      sessionIdRef.current = probe.sessionId;
      if (probe.durationSeconds > 600) {
        await cancelMediaTranscodeSession({ sessionId: probe.sessionId }).catch(() => undefined);
        sessionIdRef.current = '';
        throw new Error('去字幕视频最长支持 600 秒，请先裁剪后重试');
      }
      setPhase('transcoding');
      setStageText('正在保留原画幅转换为 H.264 MP4');
      const result = await convertMediaTranscodeSession({
        sessionId: probe.sessionId,
        startSeconds: 0,
        endSeconds: probe.durationSeconds,
        module: 'video',
        signal: controller.signal,
      });
      sessionIdRef.current = '';
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
        draftNonce: createDraftNonce(),
      };
      if (!nextDraft.width || !nextDraft.height) throw new Error('无法读取处理后视频分辨率');
      onDraftChange(nextDraft);
      setRegion({ ...DEFAULT_SUBTITLE_REGION });
      setStageText(result.transcoded
        ? '已保留原画幅转换为 H.264 MP4'
        : '原视频已是兼容格式，未重复转码');
      setPhase('ready');
    } catch (error) {
      const cancelled = controller.signal.aborted || (error as { code?: string })?.code === 'media_transcode_cancelled';
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = '';
      if (sessionId) await cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
      if (!mountedRef.current || cancelled) return;
      setPhase('error');
      setErrorMessage(error instanceof Error ? error.message : '视频处理失败，请重试');
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  };

  const handleClear = async () => {
    await cancelUnfinishedSession();
    onDraftChange(null);
    setRegion({ ...DEFAULT_SUBTITLE_REGION });
    setPhase('idle');
    setUploadProgress(0);
    setStageText('');
    setErrorMessage('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const canSubmit = Boolean(
    featureAvailable
    && draft?.sourceUrl
    && pixels
    && phase === 'ready'
    && !submitting
    && !localSubmitting,
  );

  const handleSubmit = async () => {
    if (!canSubmit || !draft || !pixels || submitLockRef.current) return;
    submitLockRef.current = true;
    setLocalSubmitting(true);
    setPhase('submitting');
    setErrorMessage('');
    try {
      await onSubmit({
        draft,
        subtitleRegionNormalized: region,
        subtitleRegionPixels: pixels,
      });
      setPhase('ready');
    } catch (error) {
      setPhase('error');
      setErrorMessage(error instanceof Error ? error.message : '去字幕任务提交失败');
    } finally {
      submitLockRef.current = false;
      setLocalSubmitting(false);
    }
  };

  const isProcessing = ['uploading', 'analyzing', 'transcoding'].includes(phase);

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 pb-10 pt-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>视频去字幕</h2>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            选择字幕所在画面区域，完成后会生成独立任务卡，原片不会被修改。
          </p>
        </div>
        {draft || isProcessing ? (
          <button type="button" onClick={() => void handleClear()} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <X size={13} /> 更换视频
          </button>
        ) : null}
      </div>

      {!featureAvailable ? (
        <div className="flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>去字幕功能暂未开放，请联系管理员。</p>
        </div>
      ) : null}

      {!draft && !isProcessing ? (
        <button
          type="button"
          disabled={!featureAvailable}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed px-6 text-center disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Upload size={22} /></span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>上传需要去字幕的视频</span>
          <span className="max-w-[520px] text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            支持最长 600 秒。系统会自动识别时长、分辨率和编码；已兼容的 H.264 MP4 不会重复转码。
          </span>
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {isProcessing ? (
        <div className="rounded-3xl border px-5 py-8" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} aria-live="polite">
          <div className="mx-auto flex max-w-[520px] flex-col items-center text-center">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{stageText}</p>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {phase === 'transcoding' ? '服务端正在处理，完成时间取决于视频时长' : '请保持页面开启'}
            </p>
            {phase === 'uploading' || phase === 'analyzing' ? (
              <div className="mt-5 w-full">
                <div className="mb-1 flex justify-between text-[10px]" style={{ color: 'var(--text-tertiary)' }}><span>上传进度</span><span>{uploadProgress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${uploadProgress}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ) : (
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
                <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {draft ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-3 text-[11px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <Film size={14} />
            <span className="max-w-[280px] truncate font-medium">{draft.fileName}</span>
            <span>{formatDuration(draft.durationSeconds)}</span>
            <span>{formatBytes(draft.sizeBytes)}</span>
            <span>{draft.width}×{draft.height}</span>
            {draft.videoCodec ? <span>{draft.videoCodec.toUpperCase()}</span> : null}
            <span className="ml-auto flex items-center gap-1" style={{ color: 'var(--accent)' }}><CheckCircle2 size={13} />{stageText}</span>
          </div>
          <SubtitleRegionEditor
            source={draft}
            region={region}
            onRegionChange={setRegion}
            disabled={submitting || localSubmitting}
          />
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-3xl border p-4 sm:flex-row sm:items-center" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              提交后会生成独立任务卡。处理中可离开页面，稍后返回查看结果。
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="flex shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {submitting || localSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
              开始去字幕
            </button>
          </div>
        </>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <div className="flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }} aria-live="polite">
          <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <div>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--danger)' }}>视频暂时无法处理</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{errorMessage}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SubtitleRemovalWorkspace;
