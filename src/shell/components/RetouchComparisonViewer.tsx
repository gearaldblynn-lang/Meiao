import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  adjustComparisonDividerPercent,
  clampComparisonPan,
  clampComparisonZoom,
  getComparisonDividerPercent,
  getComparisonZoomPan,
  getLoopedComparisonIndex,
  getSteppedComparisonZoom,
  hasDifferentImageAspectRatio,
  MAX_COMPARISON_ZOOM,
  MIN_COMPARISON_ZOOM,
  type ComparisonPoint,
  type RetouchComparisonItem,
} from './retouchComparison';

interface RetouchComparisonViewerProps {
  open: boolean;
  items: RetouchComparisonItem[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownloadCurrent?: () => void;
  heading?: string;
  dialogLabel?: string;
  originalLabel?: string;
  resultLabel?: string;
  headerActions?: React.ReactNode;
  overlayZIndex?: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

type PointerInteractionMode = 'divider' | 'pan' | null;

interface PointerStart {
  clientX: number;
  clientY: number;
  pan: ComparisonPoint;
}

const CENTERED_PAN: ComparisonPoint = { x: 0, y: 0 };

const RetouchComparisonViewer: React.FC<RetouchComparisonViewerProps> = ({
  open,
  items,
  currentIndex,
  onIndexChange,
  onClose,
  onDownloadCurrent,
  heading = '滑动查看升级效果',
  dialogLabel = '图片升级前后对比',
  originalLabel = '原图',
  resultLabel = '升级后',
  headerActions,
  overlayZIndex = 560,
}) => {
  const item = items[currentIndex];
  const [dividerPercent, setDividerPercent] = useState(50);
  const [originalLoadFailed, setOriginalLoadFailed] = useState(false);
  const [resultLoadFailed, setResultLoadFailed] = useState(false);
  const [originalDimensions, setOriginalDimensions] = useState<ImageDimensions | undefined>();
  const [resultDimensions, setResultDimensions] = useState<ImageDimensions | undefined>();
  const [zoomScale, setZoomScale] = useState(MIN_COMPARISON_ZOOM);
  const [panOffset, setPanOffset] = useState<ComparisonPoint>(CENTERED_PAN);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomScaleRef = useRef(MIN_COMPARISON_ZOOM);
  const panOffsetRef = useRef<ComparisonPoint>(CENTERED_PAN);
  const spacePressedRef = useRef(false);
  const interactionModeRef = useRef<PointerInteractionMode>(null);
  const pointerStartRef = useRef<PointerStart | undefined>(undefined);

  const changeIndex = useCallback((delta: number) => {
    onIndexChange(getLoopedComparisonIndex(currentIndex, delta, items.length));
  }, [currentIndex, items.length, onIndexChange]);

  const resetComparisonView = useCallback(() => {
    setDividerPercent(50);
    setZoomScale(MIN_COMPARISON_ZOOM);
    setPanOffset(CENTERED_PAN);
    setSpacePressed(false);
    setIsPanning(false);
    zoomScaleRef.current = MIN_COMPARISON_ZOOM;
    panOffsetRef.current = CENTERED_PAN;
    spacePressedRef.current = false;
    interactionModeRef.current = null;
    pointerStartRef.current = undefined;
  }, []);

  const setZoomAtFocalPoint = useCallback((requestedZoom: number, focalPoint: ComparisonPoint) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const nextZoom = clampComparisonZoom(requestedZoom);
    const nextPan = getComparisonZoomPan({
      currentZoom: zoomScaleRef.current,
      nextZoom,
      currentPan: panOffsetRef.current,
      focalPoint,
      viewport: { width: rect.width, height: rect.height },
    });

    zoomScaleRef.current = nextZoom;
    panOffsetRef.current = nextPan;
    setZoomScale(nextZoom);
    setPanOffset(nextPan);
  }, []);

  const changeZoom = useCallback((direction: 'in' | 'out') => {
    setZoomAtFocalPoint(
      getSteppedComparisonZoom(zoomScaleRef.current, direction),
      CENTERED_PAN,
    );
  }, [setZoomAtFocalPoint]);

  useEffect(() => {
    if (!open) return;

    resetComparisonView();
    setOriginalLoadFailed(false);
    setResultLoadFailed(false);
    setOriginalDimensions(
      item?.originalWidth && item.originalHeight
        ? { width: item.originalWidth, height: item.originalHeight }
        : undefined,
    );
    setResultDimensions(undefined);
  }, [
    item?.id,
    item?.originalHeight,
    item?.originalUrl,
    item?.originalWidth,
    item?.resultUrl,
    open,
    resetComparisonView,
  ]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.code === 'Space') {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        spacePressedRef.current = true;
        setSpacePressed(true);
        return;
      }
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

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      setSpacePressed(false);
    };

    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [changeIndex, onClose, open]);

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interactionModeRef.current === 'pan') {
      const pointerStart = pointerStartRef.current;
      if (!pointerStart) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const nextPan = clampComparisonPan({
        x: pointerStart.pan.x + event.clientX - pointerStart.clientX,
        y: pointerStart.pan.y + event.clientY - pointerStart.clientY,
      }, zoomScaleRef.current, { width: rect.width, height: rect.height });
      panOffsetRef.current = nextPan;
      setPanOffset(nextPan);
      return;
    }

    if (spacePressedRef.current) return;
    if (event.pointerType !== 'mouse' && interactionModeRef.current !== 'divider') return;
    setDividerPercent(getComparisonDividerPercent(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
    ));
  };

  const finishPointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    interactionModeRef.current = null;
    pointerStartRef.current = undefined;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setZoomAtFocalPoint(
      getSteppedComparisonZoom(zoomScaleRef.current, event.deltaY < 0 ? 'in' : 'out'),
      {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      },
    );
  };

  if (!open || !item || items.length === 0) return null;

  const aspectRatioDiffers = hasDifferentImageAspectRatio(
    originalDimensions,
    resultDimensions,
  );
  const imageTransform = `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`;
  const canResetZoom = zoomScale !== MIN_COMPARISON_ZOOM || panOffset.x !== 0 || panOffset.y !== 0;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-7"
      style={{ zIndex: overlayZIndex, background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
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
                {heading}
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

          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerActions}
            <div
              role="group"
              aria-label="对比图缩放控制"
              className="flex h-9 items-center rounded-[18px] p-1"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              <button
                type="button"
                aria-label="缩小对比图"
                title="缩小（滚轮向下）"
                disabled={zoomScale <= MIN_COMPARISON_ZOOM}
                onClick={() => changeZoom('out')}
                className="flex h-7 w-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut size={15} />
              </button>
              <span
                data-testid="retouch-comparison-zoom"
                className="w-12 text-center text-[11px] font-semibold tabular-nums"
              >
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                type="button"
                aria-label="放大对比图"
                title="放大（滚轮向上）"
                disabled={zoomScale >= MAX_COMPARISON_ZOOM}
                onClick={() => changeZoom('in')}
                className="flex h-7 w-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomIn size={15} />
              </button>
              <button
                type="button"
                aria-label="重置缩放"
                title="复位缩放与遮罩（也可双击画面）"
                disabled={!canResetZoom && dividerPercent === 50}
                onClick={resetComparisonView}
                className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full border-l disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <RotateCcw size={14} />
              </button>
            </div>
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
            ref={canvasRef}
            data-testid="retouch-comparison-canvas"
            className="relative h-full w-full select-none overflow-hidden rounded-[20px] bg-slate-900"
            style={{
              touchAction: 'none',
              cursor: isPanning ? 'grabbing' : (zoomScale > MIN_COMPARISON_ZOOM || spacePressed ? 'grab' : 'col-resize'),
            }}
            onPointerDown={(event) => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              const shouldPan = zoomScaleRef.current > MIN_COMPARISON_ZOOM || spacePressedRef.current;
              interactionModeRef.current = shouldPan ? 'pan' : 'divider';
              if (shouldPan) {
                pointerStartRef.current = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  pan: panOffsetRef.current,
                };
                setIsPanning(true);
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              if (!shouldPan) updateFromPointer(event);
            }}
            onPointerMove={updateFromPointer}
            onPointerUp={finishPointerInteraction}
            onPointerCancel={finishPointerInteraction}
            onWheel={handleWheel}
            onDoubleClick={resetComparisonView}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              {item.originalUrl && !originalLoadFailed ? (
                <img
                  data-comparison-layer="original"
                  key={`original-${item.id}-${item.originalUrl}`}
                  src={item.originalUrl}
                  alt={`${item.title} ${originalLabel}`}
                  className="pointer-events-none h-full w-full object-contain"
                  style={{ transform: imageTransform, transformOrigin: 'center center', willChange: 'transform' }}
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
                  data-comparison-layer="result"
                  key={`result-${item.id}-${item.resultUrl}`}
                  src={item.resultUrl}
                  alt={`${item.title} ${resultLabel}`}
                  className="pointer-events-none h-full w-full object-contain"
                  style={{ transform: imageTransform, transformOrigin: 'center center', willChange: 'transform' }}
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

            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white">{originalLabel}</span>
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-blue-600/85 px-2.5 py-1 text-[10px] font-semibold text-white">{resultLabel}</span>

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
          移动鼠标对比 · 滚轮缩放 · 放大后拖动画面 · 双击复位 · 方向键切图 · Esc 关闭
        </footer>
      </section>
    </div>
  );
};

export default RetouchComparisonViewer;
