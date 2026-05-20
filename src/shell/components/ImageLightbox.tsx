import React, { useEffect } from 'react';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  open: boolean;
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownloadCurrent?: () => void;
}

const ImageLightbox: React.FC<Props> = ({ open, images, currentIndex, onClose, onPrev, onNext, onDownloadCurrent }) => {
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

  if (!open || images.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center px-10 py-10"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
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
        {currentIndex + 1} / {images.length}
      </div>

      {/* Prev */}
      {images.length > 1 && (
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

      {/* Image */}
      <img
        src={images[currentIndex]}
        alt=""
        className="max-h-[80vh] max-w-[84vw] rounded-[22px] object-contain"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Next */}
      {images.length > 1 && (
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
