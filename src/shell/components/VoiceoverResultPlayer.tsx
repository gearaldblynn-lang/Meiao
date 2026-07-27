import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Square } from 'lucide-react';
import type { GeneratedResult } from '../../ShellMigratedApp';
import {
  resolveSafeVoiceoverResultMedia,
  switchVoiceoverPlaybackMode,
} from './voiceoverResultExperience';

interface Props {
  result: GeneratedResult;
  canCancel?: boolean;
  providerSubmissionStarted?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  onDownloadFinal: (url: string) => void;
}

const languageLabel = (value?: string) => String(value || '').trim() || '未记录';

const VoiceoverResultPlayer: React.FC<Props> = ({
  result,
  canCancel = false,
  providerSubmissionStarted = false,
  onCancel,
  onRetry,
  onDownloadFinal,
}) => {
  const { originalUrl, finalUrl } = resolveSafeVoiceoverResultMedia(result);
  const [preferredMode, setPreferredMode] = useState<'original' | 'final'>(finalUrl ? 'final' : 'original');
  const originalVideoRef = useRef<HTMLVideoElement | null>(null);
  const finalVideoRef = useRef<HTMLVideoElement | null>(null);
  const canShowOriginal = Boolean(originalUrl);
  const canShowFinal = Boolean(finalUrl);
  const mode = preferredMode === 'final' && !canShowFinal && canShowOriginal ? 'original' : preferredMode;
  const activeUrl = mode === 'final' ? finalUrl : originalUrl;
  const activeRef = mode === 'final' ? finalVideoRef : originalVideoRef;

  useEffect(() => {
    const mountedVideo = mode === 'final' ? finalVideoRef.current : originalVideoRef.current;
    return () => mountedVideo?.pause();
  }, [activeUrl, mode]);

  const selectMode = (nextMode: 'original' | 'final') => {
    switchVoiceoverPlaybackMode({
      currentMode: mode,
      nextMode,
      currentVideo: activeRef.current,
      setMode: setPreferredMode,
    });
  };

  const cancellationHint = useMemo(() => (
    providerSubmissionStarted
      ? 'MEIAO 会停止后续处理，但不能保证上游任务立即取消。'
      : '可在当前本地处理阶段停止任务。'
  ), [providerSubmissionStarted]);

  return (
    <article className="overflow-hidden rounded-[22px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {result.statusText || '口播翻译'}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {languageLabel(result.sourceLanguage)} → {languageLabel(result.targetLanguage)}
            {result.voiceName ? ` · 音色 ${result.voiceName}` : ''}
          </p>
        </div>
        <div className="flex rounded-full p-1" style={{ background: 'var(--bg-surface)' }}>
          <button
            type="button"
            disabled={!canShowOriginal}
            onClick={() => selectMode('original')}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
            style={{ background: mode === 'original' ? 'var(--bg-base)' : 'transparent', color: mode === 'original' ? 'var(--accent)' : 'var(--text-tertiary)' }}
          >
            原视频
          </button>
          <button
            type="button"
            disabled={!canShowFinal}
            onClick={() => selectMode('final')}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
            style={{ background: mode === 'final' ? 'var(--bg-base)' : 'transparent', color: mode === 'final' ? 'var(--accent)' : 'var(--text-tertiary)' }}
          >
            翻译结果
          </button>
        </div>
      </div>

      <div className="aspect-video bg-black">
        {activeUrl ? (
          <video
            ref={(node) => { activeRef.current = node; }}
            src={activeUrl}
            className="h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {result.error || '结果视频尚未准备好'}
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {canShowFinal ? (
            <button
              type="button"
              onClick={() => onDownloadFinal(finalUrl)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Download size={13} />
              下载结果
            </button>
          ) : null}
          {onRetry && ['error', 'retry_waiting'].includes(result.status) ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <RefreshCw size={13} />
              重试
            </button>
          ) : null}
          {canCancel && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold"
              style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
            >
              <Square size={12} />
              停止处理
            </button>
          ) : null}
        </div>
        {canCancel ? (
          <p className="text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>{cancellationHint}</p>
        ) : null}
        {result.error ? (
          <p className="rounded-xl px-3 py-2 text-[11px] leading-5" style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--error)' }}>
            {result.error}
          </p>
        ) : null}
        <details className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            查看口播文本
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>原文</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                {result.sourceTranscript || '暂无原文'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>译文</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                {result.translatedTranscript || '暂无译文'}
              </p>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
};

export default VoiceoverResultPlayer;
