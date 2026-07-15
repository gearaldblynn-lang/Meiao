import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Loader2,
  Maximize2,
  Pause,
  Play,
  Volume2,
  X,
} from 'lucide-react';

import {
  getComparisonDriftCorrection,
  shouldPauseForComparisonBuffer,
} from '../../utils/subtitleComparisonSync.mjs';

type Props = {
  sourceUrl: string;
  resultUrl: string;
  title?: string;
  onClose?: () => void;
};

type Side = 'source' | 'result';

const COMPARISON_PLAYBACK_EVENT = 'meiao:subtitle-comparison-playback';

const readPositiveNumberEnv = (key: string, fallback: number) => {
  const rawValue = import.meta.env?.[key];
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const VIDEO_PLAYBACK_MIN_BUFFER_SECONDS = readPositiveNumberEnv(
  'VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS',
  3,
);
const VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS = readPositiveNumberEnv(
  'VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS',
  5000,
);

const formatTime = (value: number) => {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const getBufferedAheadSeconds = (video: HTMLVideoElement | null) => {
  if (!video) return 0;
  const currentTime = video.currentTime || 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= currentTime && video.buffered.end(index) >= currentTime) {
      return Math.max(0, video.buffered.end(index) - currentTime);
    }
  }
  return 0;
};

const SubtitleComparisonPlayer: React.FC<Props> = ({
  sourceUrl,
  resultUrl,
  title = '去字幕前后对比',
  onClose,
}) => {
  const ownerId = useId();
  const playerRef = useRef<HTMLDivElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const resultVideoRef = useRef<HTMLVideoElement | null>(null);
  const playIntentRef = useRef(false);
  const currentTimeRef = useRef(0);
  const bufferTimerRef = useRef<number | null>(null);
  const [activeSide, setActiveSide] = useState<Side>('result');
  const [playIntent, setPlayIntent] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferMessage, setBufferMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [sideErrors, setSideErrors] = useState<Record<Side, string>>({ source: '', result: '' });
  const preloadMode = playIntent ? 'auto' : 'metadata';

  const clearBufferTimer = useCallback(() => {
    if (bufferTimerRef.current != null) {
      window.clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
  }, []);

  const pauseBoth = useCallback((clearIntent = true) => {
    sourceVideoRef.current?.pause();
    resultVideoRef.current?.pause();
    if (clearIntent) {
      playIntentRef.current = false;
      setPlayIntent(false);
      setIsBuffering(false);
      setBufferMessage('');
      clearBufferTimer();
    }
    setIsPlaying(false);
  }, [clearBufferTimer]);

  const getStreamState = useCallback((video: HTMLVideoElement | null, side: Side) => ({
    visible: true,
    readyState: video?.readyState || 0,
    bufferedAheadSeconds: getBufferedAheadSeconds(video),
    remainingSeconds: video && Number.isFinite(video.duration)
      ? Math.max(0, video.duration - video.currentTime)
      : Number.POSITIVE_INFINITY,
    ended: Boolean(video?.ended),
    failed: Boolean(sideErrors[side]),
  }), [sideErrors]);

  const evaluatePlaybackReadiness = useCallback(() => {
    if (!playIntentRef.current) return;
    const source = sourceVideoRef.current;
    const result = resultVideoRef.current;
    const shouldPause = shouldPauseForComparisonBuffer({
      playIntent: true,
      minBufferSeconds: VIDEO_PLAYBACK_MIN_BUFFER_SECONDS,
      source: getStreamState(source, 'source'),
      result: getStreamState(result, 'result'),
    });
    if (shouldPause) {
      source?.pause();
      result?.pause();
      setIsPlaying(false);
      setIsBuffering(true);
      setBufferMessage('正在同步缓冲两个视频…');
      if (bufferTimerRef.current == null) {
        bufferTimerRef.current = window.setTimeout(() => {
          bufferTimerRef.current = null;
          if (playIntentRef.current) setBufferMessage('网络较慢，仍在等待两个视频可播放…');
        }, VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS);
      }
      return;
    }
    clearBufferTimer();
    setIsBuffering(false);
    setBufferMessage('');
    const plays = [source, result]
      .filter((video): video is HTMLVideoElement => Boolean(video && !video.ended))
      .map((video) => video.play());
    void Promise.allSettled(plays).then(() => {
      if (playIntentRef.current) setIsPlaying(Boolean(result && !result.paused));
    });
  }, [clearBufferTimer, getStreamState]);

  const warmVideo = (video: HTMLVideoElement | null) => {
    if (!video || video.preload === 'auto') return;
    const targetTime = currentTimeRef.current;
    video.preload = 'auto';
    video.load();
    const restoreTime = () => {
      if (targetTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(targetTime, video.duration);
    };
    video.addEventListener('loadedmetadata', restoreTime, { once: true });
  };

  const startPlayback = () => {
    document.dispatchEvent(new CustomEvent(COMPARISON_PLAYBACK_EVENT, { detail: { ownerId } }));
    playIntentRef.current = true;
    setPlayIntent(true);
    setBufferMessage('正在准备对比播放…');
    warmVideo(sourceVideoRef.current);
    warmVideo(resultVideoRef.current);
    window.setTimeout(evaluatePlaybackReadiness, 0);
  };

  const handlePlayPause = () => {
    if (playIntentRef.current) pauseBoth();
    else startPlayback();
  };

  const handleMasterTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const master = event.currentTarget;
    const nextTime = Number(master.currentTime || 0);
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    if (Number.isFinite(master.duration)) setDuration(master.duration);
    const follower = sourceVideoRef.current;
    if (follower && !sideErrors.source) {
      const correction = getComparisonDriftCorrection({
        masterTime: master.currentTime,
        followerTime: follower.currentTime,
        thresholdSeconds: 0.12,
      });
      if (correction != null) follower.currentTime = correction;
    }
    evaluatePlaybackReadiness();
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    currentTimeRef.current = next;
    setCurrentTime(next);
    if (sourceVideoRef.current) sourceVideoRef.current.currentTime = next;
    if (resultVideoRef.current) resultVideoRef.current.currentTime = next;
    if (playIntentRef.current) window.setTimeout(evaluatePlaybackReadiness, 0);
  };

  const handleClose = () => {
    pauseBoth();
    onClose?.();
  };

  useEffect(() => {
    [sourceVideoRef.current, resultVideoRef.current].forEach((video) => {
      if (video) video.playbackRate = playbackRate;
    });
  }, [playbackRate]);

  useEffect(() => {
    if (resultVideoRef.current) {
      resultVideoRef.current.volume = volume;
      resultVideoRef.current.muted = volume === 0;
    }
  }, [volume]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) pauseBoth();
    };
    const claimPlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId?: string }>).detail;
      if (detail?.ownerId !== ownerId && playIntentRef.current) pauseBoth();
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    document.addEventListener(COMPARISON_PLAYBACK_EVENT, claimPlayback);
    return () => {
      pauseBoth();
      clearBufferTimer();
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      document.removeEventListener(COMPARISON_PLAYBACK_EVENT, claimPlayback);
    };
  }, [clearBufferTimer, ownerId, pauseBoth]);

  const renderSide = (side: Side, label: string, url: string) => {
    const isSource = side === 'source';
    const ref = isSource ? sourceVideoRef : resultVideoRef;
    return (
      <section className={`${activeSide === side ? 'block' : 'hidden'} min-w-0 md:block`} aria-label={label}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          {sideErrors[side] ? <span className="text-[10px]" style={{ color: 'var(--danger)' }}>暂时无法播放</span> : null}
        </div>
        <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl" style={{ background: '#090b10' }}>
          <video
            ref={ref}
            src={url}
            preload={preloadMode}
            playsInline
            muted={isSource ? true : volume === 0}
            className="max-h-[58vh] min-h-[240px] w-full object-contain"
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = playbackRate;
              if (!isSource && Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
            }}
            onTimeUpdate={isSource ? undefined : handleMasterTimeUpdate}
            onProgress={evaluatePlaybackReadiness}
            onCanPlay={evaluatePlaybackReadiness}
            onWaiting={() => {
              if (playIntentRef.current) evaluatePlaybackReadiness();
            }}
            onPlay={() => {
              if (!isSource) setIsPlaying(true);
            }}
            onPause={() => {
              if (!isSource && !isBuffering) setIsPlaying(false);
            }}
            onEnded={() => {
              if (!isSource) pauseBoth();
            }}
            onError={() => {
              setSideErrors((current) => ({ ...current, [side]: `${label}加载失败` }));
              window.setTimeout(evaluatePlaybackReadiness, 0);
            }}
          />
          {sideErrors[side] ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 px-5 text-center text-white">
              <span className="text-[12px]">{sideErrors[side]}</span>
              <a href={url} target="_blank" rel="noreferrer" className="text-[11px] underline">单独打开这个视频</a>
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <div ref={playerRef} className="overflow-hidden rounded-3xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>结果片负责声音，两个画面保持同步</p>
        </div>
        {onClose ? (
          <button type="button" onClick={handleClose} aria-label="关闭对比播放器" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <X size={15} />
          </button>
        ) : null}
      </div>

      <div className="flex gap-1 p-3 md:hidden" role="tablist" aria-label="选择对比画面">
        {(['source', 'result'] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="tab"
            aria-selected={activeSide === side}
            onClick={() => setActiveSide(side)}
            className="flex-1 rounded-full px-3 py-2 text-[11px] font-semibold"
            style={{
              background: activeSide === side ? 'var(--accent)' : 'var(--bg-elevated)',
              color: activeSide === side ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {side === 'source' ? '原片' : '去字幕后'}
          </button>
        ))}
      </div>

      <div className="grid gap-3 px-3 pb-3 md:grid-cols-2 md:p-4">
        {renderSide('source', '原片', sourceUrl)}
        {renderSide('result', '去字幕后', resultUrl)}
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        {isBuffering || bufferMessage ? (
          <div className="mb-2 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }} aria-live="polite">
            {isBuffering ? <Loader2 size={12} className="animate-spin" /> : null}
            {bufferMessage}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePlayPause}
            aria-label={isPlaying ? '暂停对比视频' : '播放对比视频'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: 'var(--accent)' }}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <span className="w-[76px] text-[10px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.05}
            value={Math.min(currentTime, Math.max(0.1, duration))}
            onChange={handleSeek}
            aria-label="对比播放进度"
            className="min-w-[140px] flex-1 accent-[var(--accent)]"
          />
          <select
            value={playbackRate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            aria-label="播放倍速"
            className="rounded-full border px-2 py-1.5 text-[11px] outline-none"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
          </select>
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Volume2 size={14} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="结果视频音量"
              className="w-20 accent-[var(--accent)]"
            />
          </label>
          <button
            type="button"
            onClick={() => void playerRef.current?.requestFullscreen?.()}
            aria-label="全屏查看对比"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubtitleComparisonPlayer;
