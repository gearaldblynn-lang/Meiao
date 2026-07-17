import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { RotateCcw, ScanLine, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../shell/components/ui/dialog';
import {
  MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH,
  MAX_TRANSLATION_EDIT_REGIONS,
  clipTranslationEditRegionsToImageBounds,
  clientPointToImageRatio,
  cancelTranslationRegionInteraction,
  createTranslationEditRegion,
  getContainedImageRect,
  moveTranslationEditRegion,
  removeTranslationEditRegion,
  resizeTranslationEditRegion,
  runTranslationRegionSubmit,
  tryAddTranslationEditRegion,
  validateTranslationEditRegions,
} from './translationRegionEditUtils.mjs';

export interface TranslationEditRegion {
  id: string;
  index: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  instruction: string;
}

interface TranslationRegionValidationError {
  code: string;
  regionId?: string;
}

export interface TranslationRegionEditDialogProps {
  open: boolean;
  imageUrl: string;
  sourceVersionId: string;
  title: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    sourceVersionId: string;
    regions: TranslationEditRegion[];
  }) => Promise<void>;
  onLimitReached?: () => void;
  onValidationError?: (error: TranslationRegionValidationError) => void;
}

type ImageRect = { left: number; top: number; width: number; height: number };
type RatioPoint = { xRatio: number; yRatio: number };
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type PointerInteraction = {
  pointerId: number;
  mode: 'draw' | 'move' | 'resize';
  regionId: string;
  start: RatioPoint;
  original: TranslationEditRegion;
  originalRegions: TranslationEditRegion[];
  handle?: ResizeHandle;
};

const REGION_COLORS = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed'];
const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const INSTRUCTION_ERROR_CODES = new Set([
  'missing_instruction',
  'invalid_instruction_type',
  'instruction_too_long',
  'total_instruction_too_long',
]);

const VALIDATION_MESSAGES: Record<string, string> = {
  empty_regions: '请至少框选一个需要修改的区域',
  too_many_regions: `最多可框选 ${MAX_TRANSLATION_EDIT_REGIONS} 个区域`,
  missing_instruction: '请填写该区域的修改说明',
  invalid_instruction_type: '区域说明格式不正确',
  instruction_too_long: `单个区域说明不能超过 ${MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH} 字`,
  total_instruction_too_long: '区域说明总长度超出限制',
  invalid_region_coordinates: '区域坐标无效，请重新框选',
  region_too_small: '选区过小，请放大后再提交',
  overlapping_regions: '选区之间不能重叠',
};

const HANDLE_STYLES: Record<ResizeHandle, React.CSSProperties> = {
  nw: { left: 0, top: 0, cursor: 'nwse-resize' },
  n: { left: '50%', top: 0, transform: 'translateX(-50%)', cursor: 'ns-resize' },
  ne: { right: 0, top: 0, cursor: 'nesw-resize' },
  e: { right: 0, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
  se: { right: 0, bottom: 0, cursor: 'nwse-resize' },
  s: { left: '50%', bottom: 0, transform: 'translateX(-50%)', cursor: 'ns-resize' },
  sw: { left: 0, bottom: 0, cursor: 'nesw-resize' },
  w: { left: 0, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
};

const TranslationRegionEditDialogSession: React.FC<TranslationRegionEditDialogProps> = ({
  open,
  imageUrl,
  sourceVersionId,
  title,
  pending,
  onClose,
  onSubmit,
  onLimitReached,
  onValidationError,
}) => {
  const [regions, setRegions] = useState<TranslationEditRegion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [imageRect, setImageRect] = useState<ImageRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [validationCode, setValidationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState('');
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<PointerInteraction | null>(null);
  const regionIdCounterRef = useRef(0);
  const regionRefs = useRef(new Map<string, HTMLButtonElement>());
  const instructionRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const submitLockRef = useRef(false);
  const regionsRef = useRef<TranslationEditRegion[]>([]);

  const commitRegions = (next: TranslationEditRegion[]) => {
    regionsRef.current = next;
    setRegions(next);
  };

  const validateCurrentRegions = (next: TranslationEditRegion[]) => {
    const validation = validateTranslationEditRegions(
      clipTranslationEditRegionsToImageBounds(next),
    ) as {
      ok: boolean;
      code?: string;
    };
    setValidationCode(validation.ok ? '' : (validation.code || 'invalid_regions'));
    return validation;
  };

  const updateImageRect = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || imageSize.width <= 0 || imageSize.height <= 0) return;
    const frameRect = frame.getBoundingClientRect();
    const contained = getContainedImageRect(frameRect, imageSize);
    setImageRect({
      left: contained.left - frameRect.left,
      top: contained.top - frameRect.top,
      width: contained.width,
      height: contained.height,
    });
  }, [imageSize]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateImageRect();
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateImageRect);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [open, updateImageRect]);

  const getPointerRatio = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame || imageRect.width <= 0 || imageRect.height <= 0) return null;
    const frameRect = frame.getBoundingClientRect();
    const rect = {
      left: frameRect.left + imageRect.left,
      top: frameRect.top + imageRect.top,
      width: imageRect.width,
      height: imageRect.height,
    };
    return clientPointToImageRatio(
      { x: clientX, y: clientY },
      rect,
      {
        allowOverflow: true,
      },
    ) as RatioPoint | null;
  }, [imageRect]);

  const capturePointer = (pointerId: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail when a browser ends the pointer before this handler runs.
    }
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current) return;
    if (
      pending
      || submitting
      || imageLoading
      || imageError
      || event.button !== 0
      || event.target !== event.currentTarget
    ) return;
    const start = getPointerRatio(event.clientX, event.clientY);
    if (!start) return;

    const originalRegions = regionsRef.current;
    const id = `translation-edit-region-${regionIdCounterRef.current += 1}`;
    const draft = createTranslationEditRegion(
      start,
      start,
      id,
      { allowOverflow: true },
    ) as TranslationEditRegion;
    const result = tryAddTranslationEditRegion(originalRegions, draft, MAX_TRANSLATION_EDIT_REGIONS);
    if (!result.added) {
      onLimitReached?.();
      return;
    }

    event.preventDefault();
    commitRegions(result.regions as TranslationEditRegion[]);
    setSelectedId(id);
    setValidationCode('');
    setSubmitError('');
    pointerRef.current = {
      pointerId: event.pointerId,
      mode: 'draw',
      regionId: id,
      start,
      original: draft,
      originalRegions,
    };
    capturePointer(event.pointerId);
  };

  const handleRegionPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    region: TranslationEditRegion,
  ) => {
    if (pointerRef.current) return;
    if (pending || submitting || imageLoading || imageError || event.button !== 0) return;
    const start = getPointerRatio(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(region.id);
    setValidationCode('');
    setSubmitError('');
    pointerRef.current = {
      pointerId: event.pointerId,
      mode: 'move',
      regionId: region.id,
      start,
      original: { ...region },
      originalRegions: regionsRef.current,
    };
    capturePointer(event.pointerId);
  };

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    region: TranslationEditRegion,
    handle: ResizeHandle,
  ) => {
    if (pointerRef.current) return;
    if (pending || submitting || imageLoading || imageError || event.button !== 0) return;
    const start = getPointerRatio(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(region.id);
    setValidationCode('');
    setSubmitError('');
    pointerRef.current = {
      pointerId: event.pointerId,
      mode: 'resize',
      regionId: region.id,
      start,
      original: { ...region },
      originalRegions: regionsRef.current,
      handle,
    };
    capturePointer(event.pointerId);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const point = getPointerRatio(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();

    const delta = {
      xRatio: point.xRatio - interaction.start.xRatio,
      yRatio: point.yRatio - interaction.start.yRatio,
    };
    const next = regionsRef.current.map((item) => {
      if (item.id !== interaction.regionId) return item;
      if (interaction.mode === 'draw') {
        return {
          ...createTranslationEditRegion(
            interaction.start,
            point,
            item.id,
            { allowOverflow: true },
          ),
          index: item.index,
          instruction: item.instruction,
        } as TranslationEditRegion;
      }
      if (interaction.mode === 'resize') {
        return resizeTranslationEditRegion(
          interaction.original,
          interaction.handle,
          delta,
          { allowOverflow: true },
        ) as TranslationEditRegion;
      }
      return moveTranslationEditRegion(
        interaction.original,
        delta,
        { allowOverflow: true },
      ) as TranslationEditRegion;
    });
    commitRegions(next);
  };

  const finishPointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    validateCurrentRegions(regionsRef.current);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have already released a cancelled pointer.
    }
  };

  const cancelPointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    const restored = cancelTranslationRegionInteraction(
      regionsRef.current,
      interaction,
    ) as TranslationEditRegion[];
    commitRegions(restored);
    validateCurrentRegions(restored);
  };

  const removeRegion = (regionId: string) => {
    if (pending || submitting) return;
    const current = regionsRef.current;
    const removedIndex = current.findIndex((item) => item.id === regionId);
    const next = removeTranslationEditRegion(current, regionId) as TranslationEditRegion[];
    const nextSelected = next[Math.min(Math.max(removedIndex, 0), next.length - 1)];
    setSelectedId(nextSelected?.id || null);
    commitRegions(next);
    setValidationCode('');
  };

  const clearRegions = () => {
    if (pending || submitting) return;
    commitRegions([]);
    setSelectedId(null);
    setValidationCode('');
    canvasRef.current?.focus();
  };

  const updateInstruction = (regionId: string, instruction: string) => {
    const next = regionsRef.current.map((item) => (
      item.id === regionId ? { ...item, instruction } : item
    ));
    commitRegions(next);
    setValidationCode('');
    setSubmitError('');
  };

  const handleRegionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    region: TranslationEditRegion,
    handle?: ResizeHandle,
  ) => {
    if (pending || submitting || imageLoading || imageError) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeRegion(region.id);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedId(region.id);
      return;
    }
    const step = event.shiftKey ? 0.05 : 0.01;
    const deltas: Record<string, RatioPoint> = {
      ArrowLeft: { xRatio: -step, yRatio: 0 },
      ArrowRight: { xRatio: step, yRatio: 0 },
      ArrowUp: { xRatio: 0, yRatio: -step },
      ArrowDown: { xRatio: 0, yRatio: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const nextRegion = handle
      ? resizeTranslationEditRegion(region, handle, delta, { allowOverflow: true })
      : moveTranslationEditRegion(region, delta, { allowOverflow: true });
    const next = regionsRef.current.map((item) => (
      item.id === region.id ? nextRegion as TranslationEditRegion : item
    ));
    commitRegions(next);
    validateCurrentRegions(next);
  };

  const focusValidationTarget = (code: string, regionId?: string) => {
    const targetId = regionId || regions[0]?.id;
    if (targetId) setSelectedId(targetId);
    requestAnimationFrame(() => {
      if (INSTRUCTION_ERROR_CODES.has(code) && targetId) {
        instructionRefs.current.get(targetId)?.focus();
        return;
      }
      if (targetId) {
        regionRefs.current.get(targetId)?.focus();
        return;
      }
      canvasRef.current?.focus();
    });
  };

  const submitRegions = async () => {
    if (pending || submitLockRef.current) return;
    if (imageLoading || imageError) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const validation = validateTranslationEditRegions(
        clipTranslationEditRegionsToImageBounds(regionsRef.current),
      ) as {
        ok: boolean;
        code?: string;
        regionId?: string;
        regions: TranslationEditRegion[];
      };
      if (!validation.ok) {
        const code = validation.code || 'invalid_regions';
        setValidationCode(code);
        onValidationError?.({ code, regionId: validation.regionId });
        focusValidationTarget(code, validation.regionId);
        return;
      }
      setValidationCode('');
      setSubmitError('');
      const result = await runTranslationRegionSubmit(() => (
        onSubmit({ sourceVersionId, regions: validation.regions })
      ));
      if (!result.ok) setSubmitError(result.error || '提交失败，请重试');
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : '提交失败，请重试',
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending && !submitting) onClose();
      }}
    >
      <DialogContent
        className="translation-region-dialog z-[550]"
        overlayClassName="z-[540]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending || submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending || submitting) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          canvasRef.current?.focus();
        }}
      >
        <header className="translation-region-dialog-header">
          <div className="translation-region-dialog-title-wrap">
            <ScanLine size={19} aria-hidden="true" />
            <DialogTitle asChild>
              <h2 id="translation-region-dialog-title">{title}</h2>
            </DialogTitle>
          </div>
          <button
            type="button"
            className="translation-region-icon-button"
            aria-label="关闭"
            title="关闭"
            disabled={pending || submitting}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="translation-region-dialog-body">
          <div className="translation-region-workspace">
            <div ref={frameRef} className="translation-region-image-frame">
              <img
                src={imageUrl}
                alt={title}
                draggable={false}
                onLoad={(event) => {
                  setImageLoading(false);
                  setImageError('');
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
                onError={() => {
                  setImageLoading(false);
                  setImageError('图片加载失败，请重试');
                  setImageSize({ width: 0, height: 0 });
                }}
              />
              {imageLoading && (
                <div className="translation-region-image-status" role="status">图片加载中...</div>
              )}
              {imageError && (
                <div className="translation-region-image-status is-error" role="alert">
                  {imageError}
                </div>
              )}
              <div
                ref={canvasRef}
                className="translation-region-canvas"
                style={{
                  pointerEvents: imageLoading || imageError ? 'none' : 'auto',
                }}
                tabIndex={0}
                aria-label="修改区域画布"
                aria-disabled={imageLoading || Boolean(imageError)}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={finishPointerInteraction}
                onPointerCancel={cancelPointerInteraction}
                onLostPointerCapture={cancelPointerInteraction}
              >
                <div className="translation-region-layer" style={imageRect}>
                  {regions.map((region) => {
                    const active = selectedId === region.id;
                    const color = REGION_COLORS[(region.index - 1) % REGION_COLORS.length];
                    return (
                      <div
                        key={region.id}
                        className={`translation-region-box${active ? ' is-active' : ''}`}
                        style={{
                          left: `${region.xRatio * 100}%`,
                          top: `${region.yRatio * 100}%`,
                          width: `${region.widthRatio * 100}%`,
                          height: `${region.heightRatio * 100}%`,
                          borderColor: color,
                          backgroundColor: `${color}24`,
                        }}
                      >
                        <button
                          ref={(node) => {
                            if (node) regionRefs.current.set(region.id, node);
                            else regionRefs.current.delete(region.id);
                          }}
                          type="button"
                          className="translation-region-select-button"
                          aria-label={`选择区域 ${region.index}`}
                          disabled={pending || submitting}
                          onClick={() => setSelectedId(region.id)}
                          onKeyDown={(event) => handleRegionKeyDown(event, region)}
                          onPointerDown={(event) => handleRegionPointerDown(event, region)}
                        >
                          <span className="translation-region-number" style={{ backgroundColor: color }}>
                            {region.index}
                          </span>
                        </button>
                        {active && HANDLES.map((handle) => (
                          <button
                            key={handle}
                            type="button"
                            className="translation-region-resize-handle"
                            style={{ ...HANDLE_STYLES[handle], borderColor: color }}
                            aria-label={`缩放区域 ${region.index} ${handle}`}
                            disabled={pending || submitting}
                            onKeyDown={(event) => handleRegionKeyDown(event, region, handle)}
                            onPointerDown={(event) => handleResizePointerDown(event, region, handle)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <aside className="translation-region-panel">
            <div className="translation-region-panel-heading">
              <span>修改区域</span>
              <span>{regions.length}/{MAX_TRANSLATION_EDIT_REGIONS}</span>
            </div>
            <div className="translation-region-list">
              {regions.length === 0 && (
                <div className="translation-region-empty">暂无区域</div>
              )}
              {regions.map((region) => {
                const active = selectedId === region.id;
                const color = REGION_COLORS[(region.index - 1) % REGION_COLORS.length];
                return (
                  <div
                    key={region.id}
                    className={`translation-region-item${active ? ' is-active' : ''}`}
                    style={active ? { borderColor: color } : undefined}
                    onClick={() => setSelectedId(region.id)}
                  >
                    <div className="translation-region-item-header">
                      <span className="translation-region-item-title">
                        <span className="translation-region-item-number" style={{ backgroundColor: color }}>
                          {region.index}
                        </span>
                        区域 {region.index}
                      </span>
                      <button
                        type="button"
                        className="translation-region-icon-button is-danger"
                        aria-label={`删除区域 ${region.index}`}
                        title="删除区域"
                        disabled={pending || submitting}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeRegion(region.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <textarea
                      ref={(node) => {
                        if (node) instructionRefs.current.set(region.id, node);
                        else instructionRefs.current.delete(region.id);
                      }}
                      value={region.instruction}
                      maxLength={MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH}
                      disabled={pending || submitting}
                      aria-label={`区域 ${region.index} 修改说明`}
                      placeholder="输入修改说明"
                      onFocus={() => setSelectedId(region.id)}
                      onChange={(event) => updateInstruction(region.id, event.target.value)}
                    />
                    <span className="translation-region-character-count">
                      {region.instruction.length}/{MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="translation-region-reset-button"
              disabled={pending || submitting || regions.length === 0}
              onClick={clearRegions}
            >
              <RotateCcw size={16} />
              重新框选
            </button>
          </aside>
        </div>

        <footer className="translation-region-dialog-footer">
          <div className="translation-region-error" role="alert">
            {validationCode ? (VALIDATION_MESSAGES[validationCode] || '请检查框选区域') : ''}
            {submitError ? ` ${submitError}` : ''}
          </div>
          <div className="translation-region-actions">
            <button type="button" disabled={pending || submitting} onClick={onClose}>取消</button>
            <button
              type="button"
              className="is-primary"
              disabled={
                pending
                || submitting
                || imageLoading
                || Boolean(imageError)
              }
              onClick={submitRegions}
            >
              {submitting ? '提交中...' : pending ? '修改中...' : '开始修改'}
            </button>
          </div>
        </footer>
      <style>{`
        .translation-region-dialog {
          display: flex;
          flex-direction: column;
          width: min(1180px, 94vw);
          height: min(820px, 90vh);
          max-width: none;
          overflow: hidden;
          gap: 0;
          padding: 0;
          border: 1px solid #d7dce3;
          border-radius: 8px;
          background: #ffffff;
          color: #172033;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
        }
        .translation-region-dialog button,
        .translation-region-dialog textarea {
          font: inherit;
          letter-spacing: 0;
        }
        .translation-region-dialog-header {
          display: flex;
          flex: 0 0 58px;
          align-items: center;
          justify-content: space-between;
          padding: 0 18px 0 20px;
          border-bottom: 1px solid #e4e7ec;
        }
        .translation-region-dialog-title-wrap {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 9px;
        }
        .translation-region-dialog-title-wrap h2 {
          overflow: hidden;
          margin: 0;
          font-size: 16px;
          font-weight: 650;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .translation-region-icon-button {
          display: inline-flex;
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #5b6472;
          cursor: pointer;
        }
        .translation-region-icon-button:hover:not(:disabled) { background: #f1f3f5; color: #172033; }
        .translation-region-icon-button.is-danger:hover:not(:disabled) { background: #fff0f0; color: #c92a2a; }
        .translation-region-dialog button:disabled { cursor: not-allowed; opacity: 0.5; }
        .translation-region-dialog-body {
          display: grid;
          min-height: 0;
          flex: 1 1 auto;
          grid-template-columns: minmax(0, 1fr) 360px;
          overflow-y: auto;
        }
        .translation-region-workspace {
          min-width: 0;
          min-height: 0;
          padding: 20px;
          background: #20242b;
        }
        .translation-region-image-frame {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .translation-region-image-frame > img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          user-select: none;
          pointer-events: none;
        }
        .translation-region-image-status {
          position: absolute;
          inset: 0;
          z-index: 4;
          display: grid;
          place-items: center;
          background: rgba(32, 36, 43, 0.88);
          color: #e5e7eb;
          font-size: 13px;
        }
        .translation-region-image-status.is-error { color: #fecaca; }
        .translation-region-canvas {
          position: absolute;
          inset: 0;
          outline: none;
          touch-action: none;
          cursor: crosshair;
        }
        .translation-region-canvas:focus-visible { box-shadow: 0 0 0 2px #93c5fd inset; }
        .translation-region-layer {
          position: absolute;
          pointer-events: none;
        }
        .translation-region-box {
          position: absolute;
          box-sizing: border-box;
          min-width: 1px;
          min-height: 1px;
          border: 2px solid;
          outline: none;
          cursor: move;
          touch-action: none;
          pointer-events: auto;
        }
        .translation-region-box.is-active { box-shadow: 0 0 0 1px #ffffff, 0 0 0 3px rgba(15, 23, 42, 0.5); }
        .translation-region-select-button {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          padding: 0;
          border: 0;
          outline: none;
          background: transparent;
          cursor: move;
          touch-action: none;
        }
        .translation-region-select-button:focus-visible { box-shadow: 0 0 0 2px #ffffff inset, 0 0 0 4px #2563eb; }
        .translation-region-number,
        .translation-region-item-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 12px;
          font-weight: 700;
        }
        .translation-region-number {
          position: absolute;
          top: 0;
          left: 0;
          width: 22px;
          height: 22px;
          pointer-events: none;
        }
        .translation-region-resize-handle {
          position: absolute;
          z-index: 2;
          width: 10px;
          height: 10px;
          box-sizing: border-box;
          border: 2px solid;
          border-radius: 50%;
          background: white;
          padding: 0;
        }
        .translation-region-resize-handle:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
        .translation-region-panel {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex-direction: column;
          border-left: 1px solid #e4e7ec;
          background: #f8f9fb;
        }
        .translation-region-panel-heading {
          display: flex;
          flex: 0 0 48px;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          border-bottom: 1px solid #e4e7ec;
          color: #4b5565;
          font-size: 13px;
          font-weight: 650;
        }
        .translation-region-list {
          min-height: 0;
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 12px;
        }
        .translation-region-empty {
          display: grid;
          min-height: 120px;
          place-items: center;
          color: #8b93a1;
          font-size: 13px;
        }
        .translation-region-item {
          margin-bottom: 10px;
          padding: 10px;
          border: 1px solid #dfe3e8;
          border-radius: 6px;
          background: white;
          cursor: pointer;
        }
        .translation-region-item.is-active { border-width: 2px; padding: 9px; }
        .translation-region-item-header {
          display: flex;
          height: 34px;
          align-items: center;
          justify-content: space-between;
        }
        .translation-region-item-title {
          display: inline-flex;
          min-width: 0;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 650;
        }
        .translation-region-item-number { width: 22px; height: 22px; border-radius: 4px; }
        .translation-region-item textarea {
          display: block;
          width: 100%;
          min-height: 76px;
          box-sizing: border-box;
          resize: vertical;
          padding: 9px 10px;
          border: 1px solid #ccd2da;
          border-radius: 5px;
          outline: none;
          background: #ffffff;
          color: #172033;
          font-size: 13px;
          line-height: 1.45;
        }
        .translation-region-item textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.14); }
        .translation-region-character-count {
          display: block;
          margin-top: 5px;
          color: #8b93a1;
          font-size: 11px;
          text-align: right;
        }
        .translation-region-reset-button {
          display: inline-flex;
          height: 38px;
          flex: 0 0 38px;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin: 0 12px 12px;
          border: 1px solid #ccd2da;
          border-radius: 6px;
          background: white;
          color: #4b5565;
          cursor: pointer;
        }
        .translation-region-reset-button:hover:not(:disabled) { border-color: #9aa3af; background: #f3f4f6; }
        .translation-region-dialog-footer {
          display: flex;
          min-height: 66px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 18px;
          border-top: 1px solid #e4e7ec;
          background: white;
        }
        .translation-region-error {
          min-width: 0;
          color: #c92a2a;
          font-size: 13px;
        }
        .translation-region-actions { display: flex; flex: 0 0 auto; gap: 10px; }
        .translation-region-actions button {
          height: 38px;
          min-width: 86px;
          padding: 0 16px;
          border: 1px solid #ccd2da;
          border-radius: 6px;
          background: white;
          color: #374151;
          cursor: pointer;
        }
        .translation-region-actions button:hover:not(:disabled) { background: #f3f4f6; }
        .translation-region-actions button.is-primary {
          border-color: #2563eb;
          background: #2563eb;
          color: white;
        }
        .translation-region-actions button.is-primary:hover:not(:disabled) { background: #1d4ed8; }
        @media (max-width: 820px) {
          .translation-region-dialog { width: min(96vw, 680px); height: 95vh; }
          .translation-region-dialog-body {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(280px, 1fr) minmax(230px, 0.72fr);
          }
          .translation-region-panel { border-top: 1px solid #e4e7ec; border-left: 0; }
          .translation-region-workspace { padding: 12px; }
          .translation-region-dialog-footer { align-items: stretch; flex-direction: column; gap: 8px; }
          .translation-region-actions { justify-content: flex-end; }
        }
        @media (max-height: 680px) {
          .translation-region-dialog { height: calc(100vh - 16px); }
          .translation-region-dialog-header { flex-basis: 48px; }
          .translation-region-dialog-body { min-height: 0; overflow-y: auto; }
          .translation-region-workspace { min-height: 220px; padding: 10px; }
          .translation-region-panel { min-height: 180px; }
          .translation-region-list { min-height: 120px; }
          .translation-region-dialog-footer { min-height: 54px; padding-top: 8px; padding-bottom: 8px; }
        }
      `}</style>
      </DialogContent>
    </Dialog>
  );
};

const TranslationRegionEditDialog: React.FC<TranslationRegionEditDialogProps> = (props) => {
  if (!props.open) return null;
  return (
    <TranslationRegionEditDialogSession
      key={`${props.sourceVersionId}::${props.imageUrl}`}
      {...props}
    />
  );
};

export default TranslationRegionEditDialog;
