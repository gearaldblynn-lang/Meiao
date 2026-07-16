import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import {
  adjustComparisonDividerPercent,
  getComparisonDividerPercent,
  getLoopedComparisonIndex,
  hasDifferentImageAspectRatio,
  type RetouchComparisonItem,
} from './retouchComparison';

interface RetouchComparisonViewerProps {
  open: boolean;
  items: RetouchComparisonItem[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownloadCurrent?: () => void;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const RetouchComparisonViewer: React.FC<RetouchComparisonViewerProps> = ({
  open,
  items,
  currentIndex,
  onIndexChange,
  onClose,
  onDownloadCurrent,
}) => {
  const item = items[currentIndex];
  const [dividerPercent, setDividerPercent] = useState(50);
  const [originalLoadFailed, setOriginalLoadFailed] = useState(false);
  const [resultLoadFailed, setResultLoadFailed] = useState(false);
  const [originalDimensions, setOriginalDimensions] = useState<ImageDimensions | undefined>();
  const [resultDimensions, setResultDimensions] = useState<ImageDimensions | undefined>();
  const draggingRef = useRef(false);

  const changeIndex = useCallback((delta: number) => {
    onIndexChange(getLoopedComparisonIndex(currentIndex, delta, items.length));
  }, [currentIndex, items.length, onIndexChange]);

  useEffect(() => {
    setDividerPercent(50);
    setOriginalLoadFailed(false);
    setResultLoadFailed(false);
    setOriginalDimensions(
      item?.originalWidth && item.originalHeight
        ? { width: item.originalWidth, height: item.originalHeight }
        : undefined,
    );
    setResultDimensions(undefined);
    draggingRef.current = false;
  }, [item?.id, item?.originalHeight, item?.originalWidth]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        changeIndex(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        changeIndex(1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [changeIndex, onClose, open]);

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && !draggingRef.current) return;
    setDividerPercent(getComparisonDividerPercent(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
    ));
  };

  const finishPointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!open || !item || items.length === 0) return null;

  const aspectRatioDiffers = hasDifferentImageAspectRatio(
    originalDimensions,
    resultDimensions,
  );

  return (
    <div
      className="fixed inset-0 z-[560] flex items-center justify-center p-4 sm:p-7"
      style={{ background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="图片升级前后对比"
        className="flex h-[92vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-[28px] border"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'rgba(255,255,255,0.16)',
          boxShadow: '0 28px 90px rgba(0,0,0,0.52)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                滑动查看升级效果
              </h3>
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {item.subFeatureLabel}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span className="max-w-[520px] truncate">{item.title}</span>
              <span>{currentIndex + 1} / {items.length}</span>
              {aspectRatioDiffers ? (
                <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                  前后比例不同
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onDownloadCurrent ? (
              <button
                type="button"
                onClick={onDownloadCurrent}
                className="flex h-9 items-center gap-2 rounded-[18px] px-3 text-[12px] font-medium"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Download size={15} />
                下载结果
              </button>
            ) : null}
            <button
              type="button"
              aria-label="关闭对比查看器"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-[18px]"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 bg-slate-950 p-2 sm:p-4">
          <div
            data-testid="retouch-comparison-canvas"
            className="relative h-full w-full cursor-col-resize select-none overflow-hidden rounded-[20px] bg-slate-900"
            style={{ touchAction: 'none' }}
            onPointerDown={(event) => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromPointer(event);
            }}
            onPointerMove={updateFromPointer}
            onPointerUp={finishPointerInteraction}
            onPointerCancel={finishPointerInteraction}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              {item.originalUrl && !originalLoadFailed ? (
                <img
                  key={`original-${item.id}-${item.originalUrl}`}
                  src={item.originalUrl}
                  alt={`${item.title} 原图`}
                  className="pointer-events-none h-full w-full object-contain"
                  draggable={false}
                  onLoad={(event) => setOriginalDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                  onError={() => setOriginalLoadFailed(true)}
                />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-center text-[12px] text-white/65">
                  <span className="font-semibold">原图加载失败</span>
                  <span className="text-[10px] text-white/40">仍可查看升级结果并切换其他图片</span>
                </div>
              )}
            </div>

            <div
              className="absolute inset-0 flex items-center justify-center overflow-hidden bg-slate-900"
              style={{ clipPath: `inset(0 0 0 ${dividerPercent}%)` }}
            >
              {!resultLoadFailed ? (
                <img
                  key={`result-${item.id}-${item.resultUrl}`}
                  src={item.resultUrl}
                  alt={`${item.title} 升级后`}
                  className="pointer-events-none h-full w-full object-contain"
                  draggable={false}
                  onLoad={(event) => setResultDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                  onError={() => setResultLoadFailed(true)}
                />
              ) : (
                <div className="text-[12px] font-semibold text-white/65">结果加载失败</div>
              )}
            </div>

            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white">原图</span>
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-blue-600/85 px-2.5 py-1 text-[10px] font-semibold text-white">升级后</span>

            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.18),0_0_18px_rgba(0,0,0,0.4)]"
              style={{ left: `${dividerPercent}%` }}
            />
            <button
              type="button"
              role="slider"
              aria-label="调整前后对比遮罩"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(dividerPercent)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                event.stopPropagation();
                setDividerPercent((value) => adjustComparisonDividerPercent(value, event.key));
              }}
              className="absolute top-1/2 flex h-12 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white text-slate-700 shadow-[0_8px_28px_rgba(0,0,0,0.35)] outline-none focus:ring-2 focus:ring-blue-400"
              style={{ left: `${dividerPercent}%` }}
            >
              <span className="flex gap-[3px]" aria-hidden="true">
                <span className="h-4 w-px rounded-full bg-slate-400" />
                <span className="h-4 w-px rounded-full bg-slate-400" />
              </span>
            </button>
          </div>

          {items.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="上一张对比图"
                onClick={() => changeIndex(-1)}
                className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px] bg-black/55 text-white transition-colors hover:bg-black/75 sm:left-6"
              >
                <ChevronLeft size={19} />
              </button>
              <button
                type="button"
                aria-label="下一张对比图"
                onClick={() => changeIndex(1)}
                className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px] bg-black/55 text-white transition-colors hover:bg-black/75 sm:right-6"
              >
                <ChevronRight size={19} />
              </button>
            </>
          ) : null}
        </div>

        <footer
          className="shrink-0 border-t px-4 py-2.5 text-center text-[11px] sm:px-6"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          移动鼠标或拖动中间分割线查看前后差异 · 方向键切换图片 · Esc 关闭
        </footer>
      </section>
    </div>
  );
};

export default RetouchComparisonViewer;
