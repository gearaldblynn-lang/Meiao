import React, { useEffect, useRef, useState } from 'react';
import { Download, X, ChevronLeft, ChevronRight, Move } from 'lucide-react';
import { detectRemoteMp4VideoCodec, getBrowserVideoCodecWarning } from '../../utils/videoCodec';

export interface LightboxMediaItem {
  url: string;
  type?: 'image' | 'video';
  title?: string;
  videoCodec?: string;
}

interface Props {
  open: boolean;
  images: string[];
  items?: LightboxMediaItem[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownloadCurrent?: () => void;
  actionLabel?: string;
  onActionCurrent?: () => void;
}

const getVideoMimeType = (item?: LightboxMediaItem) => {
  const source = `${item?.url || ''} ${item?.title || ''}`.toLowerCase();
  if (/\.(mov|qt)(?:\?|#|$)/.test(source)) return 'video/quicktime';
  if (/\.webm(?:\?|#|$)/.test(source)) return 'video/webm';
  return 'video/mp4';
};

const ImageLightbox: React.FC<Props> = ({ open, images, items, currentIndex, onClose, onPrev, onNext, onDownloadCurrent, actionLabel, onActionCurrent }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoError, setVideoError] = useState('');
  const [detectedVideoCodec, setDetectedVideoCodec] = useState('');

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, onPrev, onNext]);

  const mediaItems: LightboxMediaItem[] = items?.length
    ? items
    : images.map((url) => ({ url, type: 'image' as const }));
  const currentItem = mediaItems[currentIndex];
  const isVideo = currentItem?.type === 'video';
  const lightboxOverlayStyle = isVideo
    ? { background: 'rgba(0,0,0,0.92)' }
    : { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' };

  useEffect(() => {
    if (!open || !isVideo || !currentItem) return;
    setVideoError('');
    document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      if (video !== videoRef.current && !video.paused) {
        video.pause();
      }
    });
    return () => {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    };
  }, [open, isVideo, currentItem]);

  useEffect(() => {
    setVideoError('');
    setDetectedVideoCodec('');
  }, [currentItem?.url]);

  useEffect(() => {
    if (!open || !isVideo || !currentItem?.url) return;
    const knownCodec = currentItem.videoCodec || '';
    if (knownCodec) {
      setDetectedVideoCodec(knownCodec);
      setVideoError(getBrowserVideoCodecWarning(knownCodec));
      return;
    }
    let cancelled = false;
    void detectRemoteMp4VideoCodec(currentItem.url)
      .then((codec) => {
        if (cancelled || !codec) return;
        setDetectedVideoCodec(codec);
        const warning = getBrowserVideoCodecWarning(codec);
        if (warning) setVideoError(warning);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentItem?.url, currentItem?.videoCodec, isVideo, open]);

  if (!open || mediaItems.length === 0 || !currentItem) return null;

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center px-10 py-10"
      style={lightboxOverlayStyle}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-[18px] transition-colors"
        style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
      >
        <X size={18} />
      </button>

      {onDownloadCurrent ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownloadCurrent();
          }}
          className="absolute right-5 top-16 flex h-9 items-center gap-2 rounded-[18px] px-3 text-[12px] font-medium transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
        >
          <Download size={16} />
          下载
        </button>
      ) : null}

      {/* Counter */}
      <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-medium" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
        {currentIndex + 1} / {mediaItems.length}
      </div>

      {/* Prev */}
      {mediaItems.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px] transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
        >
          <ChevronLeft size={18} />
        </button>
      )}

      {isVideo ? (
        <div className="flex max-h-[86vh] w-full max-w-5xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          {currentItem.title ? (
            <div className="truncate px-1 text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>
              {currentItem.title}
            </div>
          ) : null}
          <video
            key={currentItem.url}
            ref={videoRef}
            data-meiao-lightbox-video="true"
            className="meiao-video-no-fullscreen max-h-[82vh] min-h-[320px] w-full object-contain"
            controls
            controlsList="nofullscreen nodownload noremoteplayback"
            disablePictureInPicture
            playsInline
            preload="auto"
            style={{ background: '#000', aspectRatio: '16 / 9' }}
            onLoadedMetadata={(event) => {
              const codecWarning = getBrowserVideoCodecWarning(currentItem.videoCodec || detectedVideoCodec);
              setVideoError(codecWarning);
              const video = event.currentTarget;
              if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime === 0) {
                try {
                  video.currentTime = Math.min(0.2, Math.max(0, video.duration - 0.05));
                } catch {
                  // Metadata is still enough for playback; some browsers reject early seeks.
                }
              }
            }}
            onCanPlay={() => setVideoError(getBrowserVideoCodecWarning(currentItem.videoCodec || detectedVideoCodec))}
            onError={() => setVideoError('视频预览加载失败。请确认文件是浏览器可播放的 MP4/H.264 编码，或重新上传转码后的视频。')}
            onPlay={(event) => {
              document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
                if (video !== event.currentTarget && !video.paused) {
                  video.pause();
                }
              });
            }}
          >
            <source src={currentItem.url} type={getVideoMimeType(currentItem)} />
          </video>
          {videoError ? (
            <div className="rounded-[14px] px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.16)', color: 'rgba(255,255,255,0.9)' }}>
              {videoError}
            </div>
          ) : null}
        </div>
      ) : (
        <img
          src={currentItem.url}
          alt=""
          className="max-h-[80vh] max-w-[84vw] rounded-[22px] object-contain"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {actionLabel && onActionCurrent ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActionCurrent();
          }}
          className="absolute bottom-8 left-1/2 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full px-5 text-[14px] font-semibold shadow-[0_18px_40px_rgba(37,99,235,0.35)] transition-transform hover:scale-[1.03]"
          style={{ background: 'rgba(37,99,235,0.96)', color: '#fff' }}
        >
          <Move size={17} />
          {actionLabel}
        </button>
      ) : null}

      {/* Next */}
      {mediaItems.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px] transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
};

export default ImageLightbox;
