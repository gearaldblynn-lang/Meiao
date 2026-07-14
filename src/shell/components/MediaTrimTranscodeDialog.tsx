import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import {
  AlertCircle,
  CheckCircle2,
  Film,
  Loader2,
  Music2,
  Scissors,
  X,
} from 'lucide-react';

import {
  cancelMediaTranscodeSession,
  convertMediaTranscodeSession,
  createMediaTranscodeSession,
  type MediaTranscodeKind,
  type MediaTranscodeProbe,
  type MediaTranscodeResult,
} from '../../services/mediaTranscodeClient';
import { normalizeTrimSelection } from '../../utils/mediaTrimRules.mjs';

export type MediaTranscodeQueueItem = {
  id: string;
  type: 'referenceVideo' | 'audio';
  kind: MediaTranscodeKind;
  file: File;
  subFeature?: string;
};

type Props = {
  item: MediaTranscodeQueueItem;
  remainingSeconds: number;
  queuePosition?: number;
  queueLength?: number;
  onComplete: (result: MediaTranscodeResult) => void;
  onCancel: () => void;
};

type DialogState = 'uploading' | 'ready' | 'converting' | 'completed' | 'error';

const formatSeconds = (value: number) => {
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

const MediaTrimTranscodeDialog: React.FC<Props> = ({
  item,
  remainingSeconds,
  queuePosition = 1,
  queueLength = 1,
  onComplete,
  onCancel,
}) => {
  const [dialogState, setDialogState] = useState<DialogState>('uploading');
  const [probe, setProbe] = useState<MediaTranscodeProbe | null>(null);
  const [selection, setSelection] = useState<[number, number]>([0, Math.min(15, remainingSeconds)]);
  const [progress, setProgress] = useState(8);
  const [errorMessage, setErrorMessage] = useState('');
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const sessionIdRef = useRef('');
  const activeRequestRef = useRef<AbortController | null>(null);
  const completedRef = useRef(false);
  const previewUrl = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  const isBusy = dialogState === 'converting';
  const selectedSeconds = Math.max(0, selection[1] - selection[0]);

  useEffect(() => {
    completedRef.current = false;
    sessionIdRef.current = '';
    setDialogState('uploading');
    setProgress(8);
    setErrorMessage('');
    const controller = new AbortController();
    activeRequestRef.current = controller;

    void createMediaTranscodeSession({ file: item.file, kind: item.kind, signal: controller.signal })
      .then((nextProbe) => {
        if (controller.signal.aborted) return;
        if (!nextProbe.sessionId) throw new Error('服务端未返回媒体处理会话，请重试');
        sessionIdRef.current = nextProbe.sessionId;
        const initial = normalizeTrimSelection({
          durationSeconds: nextProbe.durationSeconds,
          startSeconds: 0,
          endSeconds: Math.min(nextProbe.durationSeconds, remainingSeconds, 15),
          remainingSeconds,
        });
        setProbe(nextProbe);
        setSelection([initial.startSeconds, initial.endSeconds]);
        setProgress(100);
        setDialogState('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.code === 'media_transcode_cancelled') return;
        setDialogState('error');
        setErrorMessage(error instanceof Error ? error.message : '素材分析失败，请重试或更换文件');
      });

    return () => {
      controller.abort();
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      const sessionId = sessionIdRef.current;
      if (sessionId && !completedRef.current) {
        void cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
      }
    };
  }, [analysisAttempt, item.file, item.kind, remainingSeconds]);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    if (dialogState !== 'converting') return undefined;
    setProgress(16);
    const timer = globalThis.setInterval(() => {
      setProgress((current) => Math.min(88, current + (current < 55 ? 7 : 3)));
    }, 700);
    return () => globalThis.clearInterval(timer);
  }, [dialogState]);

  const seekPreview = (seconds: number) => {
    if (!mediaRef.current || !Number.isFinite(seconds)) return;
    try {
      mediaRef.current.currentTime = seconds;
    } catch {
      // Some source formats can be transcoded by FFmpeg but not previewed by the browser.
    }
  };

  const handleSelectionChange = (values: number[]) => {
    if (!probe || values.length < 2 || isBusy) return;
    try {
      const next = normalizeTrimSelection({
        durationSeconds: probe.durationSeconds,
        startSeconds: values[0],
        endSeconds: values[1],
        remainingSeconds,
      });
      const nextTuple: [number, number] = [next.startSeconds, next.endSeconds];
      const seekTarget = Math.abs(nextTuple[0] - selection[0]) >= Math.abs(nextTuple[1] - selection[1])
        ? nextTuple[0]
        : nextTuple[1];
      setSelection(nextTuple);
      seekPreview(seekTarget);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '裁剪范围无效');
    }
  };

  const handleConvert = async () => {
    const sessionId = sessionIdRef.current;
    if (!probe || !sessionId || isBusy) return;
    setDialogState('converting');
    setErrorMessage('');
    const controller = new AbortController();
    activeRequestRef.current = controller;
    try {
      const result = await convertMediaTranscodeSession({
        sessionId,
        startSeconds: selection[0],
        endSeconds: selection[1],
        module: 'video',
        signal: controller.signal,
      });
      completedRef.current = true;
      sessionIdRef.current = '';
      setProgress(100);
      setDialogState('completed');
      onComplete(result);
    } catch (error) {
      if (error?.code === 'media_transcode_cancelled') return;
      sessionIdRef.current = '';
      setDialogState('error');
      setErrorMessage(error instanceof Error ? error.message : '转换失败，请重新上传这个文件');
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (isBusy) return;
    activeRequestRef.current?.abort();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = '';
    if (sessionId) {
      await cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
    }
    onCancel();
  };

  const statusText = dialogState === 'uploading'
    ? '正在分析素材'
    : dialogState === 'converting'
      ? progress < 68 ? '转换中' : '保存素材中'
      : dialogState === 'completed'
        ? '转换完成'
        : dialogState === 'error'
          ? '处理失败'
          : '已完成分析，可选择保留范围';

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center p-3 sm:p-5"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-trim-title"
    >
      <div
        className="flex max-h-[94vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border"
        style={{
          background: 'var(--bg-base)',
          borderColor: 'var(--border-subtle)',
          boxShadow: 'var(--shadow-elevated)',
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Scissors size={17} style={{ color: 'var(--accent)' }} />
              <h2 id="media-trim-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                裁剪并转换{item.kind === 'video' ? '视频' : '音频'}
              </h2>
            </div>
            <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {item.file.name} · 第 {queuePosition}/{queueLength} 个
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={isBusy}
            className="ml-3 flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
            aria-label="关闭媒体裁剪"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          <div
            className="relative flex w-full items-center justify-center overflow-hidden rounded-3xl border"
            style={{
              height: 'min(46vh, 360px)',
              minHeight: item.kind === 'audio' ? 210 : 240,
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {item.kind === 'video' ? (
              <video
                ref={(node) => { mediaRef.current = node; }}
                src={previewUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                onTimeUpdate={(event) => {
                  if (event.currentTarget.currentTime >= selection[1]) {
                    event.currentTarget.pause();
                    event.currentTarget.currentTime = selection[0];
                  }
                }}
              />
            ) : (
              <div className="flex w-full flex-col items-center px-8">
                <div className="mb-7 flex h-20 items-end justify-center gap-1" aria-hidden="true">
                  {Array.from({ length: 32 }, (_, index) => (
                    <span
                      key={index}
                      className="w-1.5 rounded-full"
                      style={{
                        height: `${22 + ((index * 17) % 58)}%`,
                        background: index % 4 === 0 ? 'var(--accent)' : 'var(--text-tertiary)',
                        opacity: index % 4 === 0 ? 0.9 : 0.35,
                      }}
                    />
                  ))}
                </div>
                <Music2 size={28} style={{ color: 'var(--accent)' }} />
                <audio
                  ref={(node) => { mediaRef.current = node; }}
                  src={previewUrl}
                  controls
                  preload="metadata"
                  className="mt-4 w-full max-w-[460px]"
                  onTimeUpdate={(event) => {
                    if (event.currentTarget.currentTime >= selection[1]) {
                      event.currentTarget.pause();
                      event.currentTarget.currentTime = selection[0];
                    }
                  }}
                />
              </div>
            )}

            {dialogState === 'uploading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: 'color-mix(in srgb, var(--bg-base) 82%, transparent)' }}>
                <Loader2 className="animate-spin" size={24} style={{ color: 'var(--accent)' }} />
                <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>正在分析素材</span>
              </div>
            )}
          </div>

          {probe && (
            <div className="mt-4 rounded-3xl border px-4 py-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {item.kind === 'video' ? <Film size={14} /> : <Music2 size={14} />}
                  <span>{formatSeconds(probe.durationSeconds)}</span>
                  <span>·</span>
                  <span>{formatBytes(probe.sizeBytes)}</span>
                  {probe.width && probe.height ? <><span>·</span><span>{probe.width}×{probe.height}</span></> : null}
                </div>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  将转为 {item.kind === 'video' ? 'MP4 · H.264 · 30 FPS' : 'MP3 · 44.1 kHz'}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] font-medium">
                <span style={{ color: 'var(--text-secondary)' }}>选择保留范围</span>
                <span style={{ color: 'var(--accent)' }}>
                  {formatSeconds(selection[0])} – {formatSeconds(selection[1])} · {selectedSeconds.toFixed(1)} 秒
                </span>
              </div>
              <Slider.Root
                className="relative mt-4 flex h-7 w-full touch-none select-none items-center"
                min={0}
                max={Math.max(2, probe.durationSeconds)}
                step={0.1}
                value={selection}
                minStepsBetweenThumbs={20}
                disabled={isBusy}
                onValueChange={handleSelectionChange}
              >
                <Slider.Track className="relative h-2 grow overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
                  <Slider.Range className="absolute h-full rounded-full" style={{ background: 'var(--accent)' }} />
                </Slider.Track>
                <Slider.Thumb
                  className="block h-5 w-5 rounded-full border-2 bg-white shadow-md outline-none focus:ring-4"
                  style={{ borderColor: 'var(--accent)' }}
                  aria-label="裁剪开始时间"
                />
                <Slider.Thumb
                  className="block h-5 w-5 rounded-full border-2 bg-white shadow-md outline-none focus:ring-4"
                  style={{ borderColor: 'var(--accent)' }}
                  aria-label="裁剪结束时间"
                />
              </Slider.Root>
              <div className="mt-1 flex justify-between text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>0:00.0</span>
                <span>单段 2–15 秒 · 本任务还可用 {remainingSeconds.toFixed(1)} 秒</span>
                <span>{formatSeconds(probe.durationSeconds)}</span>
              </div>
            </div>
          )}

          {(dialogState === 'converting' || dialogState === 'completed') && (
            <div className="mt-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span style={{ color: 'var(--text-secondary)' }}>{statusText}</span>
                <span style={{ color: 'var(--accent)' }}>{Math.round(progress)}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--bg-elevated)' }}
                role="progressbar"
                aria-label="媒体转换进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          )}

          {dialogState === 'error' && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }} aria-live="polite">
              <AlertCircle className="mt-0.5 shrink-0" size={16} style={{ color: 'var(--danger)' }} />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold" style={{ color: 'var(--danger)' }}>这个文件暂时无法处理</p>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{errorMessage}</p>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>可关闭后更换文件；若是网络问题，也可以重新分析。</p>
              </div>
            </div>
          )}

          <p className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }} aria-live="polite">
            {dialogState === 'completed' ? <CheckCircle2 size={13} style={{ color: 'var(--accent)' }} /> : null}
            {statusText}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 sm:px-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={isBusy}
            className="rounded-full px-4 py-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          {dialogState === 'error' ? (
            <button
              type="button"
              onClick={() => setAnalysisAttempt((current) => current + 1)}
              className="rounded-full px-5 py-2.5 text-[12px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              重新分析
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleConvert()}
              disabled={dialogState !== 'ready' || selectedSeconds < 2}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
              {isBusy ? statusText : '转换并继续'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaTrimTranscodeDialog;
