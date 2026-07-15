import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { SubtitleRemovalRegion, SubtitleRemovalSourceDraft } from '../../types';
import {
  clampSubtitleRegion,
  moveSubtitleRegion,
  resizeSubtitleRegion,
  subtitleRegionToPixels,
} from '../../utils/subtitleRemovalRegion.mjs';

type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

type MediaRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Props = {
  source: SubtitleRemovalSourceDraft;
  region: SubtitleRemovalRegion;
  onRegionChange: (region: SubtitleRemovalRegion) => void;
  disabled?: boolean;
};

type PointerInteraction = {
  pointerId: number;
  mode: 'move' | 'resize';
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  startRegion: SubtitleRemovalRegion;
};

export const calculateContainedMediaRect = (
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): MediaRect => {
  if (containerWidth <= 0 || containerHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
};

const cursorByHandle: Record<ResizeHandle, React.CSSProperties['cursor']> = {
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
};

const positionByHandle: Record<ResizeHandle, React.CSSProperties> = {
  n: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' },
  ne: { right: 0, top: 0, transform: 'translate(50%, -50%)' },
  e: { right: 0, top: '50%', transform: 'translate(50%, -50%)' },
  se: { right: 0, bottom: 0, transform: 'translate(50%, 50%)' },
  s: { left: '50%', bottom: 0, transform: 'translate(-50%, 50%)' },
  sw: { left: 0, bottom: 0, transform: 'translate(-50%, 50%)' },
  w: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' },
  nw: { left: 0, top: 0, transform: 'translate(-50%, -50%)' },
};

const SubtitleRegionEditor: React.FC<Props> = ({
  source,
  region,
  onRegionChange,
  disabled = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRectRef = useRef<MediaRect>({ left: 0, top: 0, width: 0, height: 0 });
  const interactionRef = useRef<PointerInteraction | null>(null);
  const onRegionChangeRef = useRef(onRegionChange);
  const [mediaRect, setMediaRect] = useState<MediaRect>(mediaRectRef.current);
  const normalizedRegion = useMemo(() => clampSubtitleRegion(region), [region]);

  useEffect(() => {
    onRegionChangeRef.current = onRegionChange;
  }, [onRegionChange]);

  const updateMediaRect = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const videoWidth = videoRef.current?.videoWidth || source.width;
    const videoHeight = videoRef.current?.videoHeight || source.height;
    const next = calculateContainedMediaRect(
      container.clientWidth,
      container.clientHeight,
      videoWidth,
      videoHeight,
    );
    mediaRectRef.current = next;
    setMediaRect(next);
  }, [source.height, source.width]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(updateMediaRect);
    observer.observe(container);
    updateMediaRect();
    return () => observer.disconnect();
  }, [updateMediaRect]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      const currentRect = mediaRectRef.current;
      if (!interaction || event.pointerId !== interaction.pointerId || !currentRect.width || !currentRect.height) return;
      const delta = {
        x: (event.clientX - interaction.startX) / currentRect.width,
        y: (event.clientY - interaction.startY) / currentRect.height,
      };
      const next = interaction.mode === 'move'
        ? moveSubtitleRegion(interaction.startRegion, delta)
        : resizeSubtitleRegion(interaction.startRegion, interaction.handle, delta);
      onRegionChangeRef.current(next);
    };
    const handlePointerEnd = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
    };
    const pauseWhenHidden = () => {
      if (document.hidden) videoRef.current?.pause();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      videoRef.current?.pause();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('visibilitychange', pauseWhenHidden);
    };
  }, []);

  const startInteraction = (
    event: React.PointerEvent<HTMLElement>,
    mode: PointerInteraction['mode'],
    handle?: ResizeHandle,
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      pointerId: event.pointerId,
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRegion: normalizedRegion,
    };
  };

  const handleKeyboard = (event: React.KeyboardEvent<HTMLElement>, handle?: ResizeHandle) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.altKey ? 0.002 : 0.01;
    const delta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    };
    onRegionChange(event.shiftKey
      ? resizeSubtitleRegion(normalizedRegion, handle || 'se', delta)
      : moveSubtitleRegion(normalizedRegion, delta));
  };

  const pixels = useMemo(
    () => subtitleRegionToPixels(normalizedRegion, source.width, source.height),
    [normalizedRegion, source.height, source.width],
  );
  const overlayStyle: React.CSSProperties = {
    left: mediaRect.left + normalizedRegion.x * mediaRect.width,
    top: mediaRect.top + normalizedRegion.y * mediaRect.height,
    width: normalizedRegion.width * mediaRect.width,
    height: normalizedRegion.height * mediaRect.height,
  };
  const handleStyle = (handle: ResizeHandle): React.CSSProperties => ({
    ...positionByHandle[handle],
    cursor: cursorByHandle[handle],
    background: 'var(--bg-elevated)',
    borderColor: 'var(--accent)',
  });
  const handleProps = (handle: ResizeHandle) => ({
    type: 'button' as const,
    className: 'absolute z-20 h-4 w-4 rounded-full border-2 shadow-sm outline-none focus:ring-4',
    style: handleStyle(handle),
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => startInteraction(event, 'resize', handle),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => handleKeyboard(event, handle),
    disabled,
    'aria-label': `调整字幕区域 ${handle}`,
  });

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative min-h-[260px] w-full overflow-hidden rounded-3xl border"
        style={{
          height: 'clamp(260px, 55vh, 560px)',
          background: '#090b10',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <video
          ref={videoRef}
          src={source.sourceUrl}
          preload="metadata"
          playsInline
          controls
          className="absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={updateMediaRect}
        />
        {mediaRect.width > 0 && mediaRect.height > 0 ? (
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label="已选择的字幕区域，可拖动或用方向键调整"
            className="absolute z-10 touch-none border-2 outline-none focus:ring-4"
            style={{
              ...overlayStyle,
              cursor: disabled ? 'default' : 'move',
              borderColor: 'var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
              boxShadow: '0 0 0 1px color-mix(in srgb, var(--bg-elevated) 75%, transparent)',
            }}
            onPointerDown={(event) => startInteraction(event, 'move')}
            onKeyDown={(event) => handleKeyboard(event)}
          >
            <span className="pointer-events-none absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-semibold text-white" style={{ background: 'color-mix(in srgb, var(--accent) 88%, black)' }}>
              去字幕区域
            </span>
            <button {...handleProps('n')} data-handle="n" />
            <button {...handleProps('ne')} data-handle="ne" />
            <button {...handleProps('e')} data-handle="e" />
            <button {...handleProps('se')} data-handle="se" />
            <button {...handleProps('s')} data-handle="s" />
            <button {...handleProps('sw')} data-handle="sw" />
            <button {...handleProps('w')} data-handle="w" />
            <button {...handleProps('nw')} data-handle="nw" />
          </div>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-[11px]"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
      >
        <span>拖动移动，拖拽四边或四角缩放</span>
        <span className="font-mono" style={{ color: 'var(--accent)' }}>
          x1 {pixels.x1} · y1 {pixels.y1} · x2 {pixels.x2} · y2 {pixels.y2}
        </span>
      </div>
    </div>
  );
};

export default SubtitleRegionEditor;
