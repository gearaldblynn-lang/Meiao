import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import type { Material } from '../../ShellMigratedApp';
import { fetchImageBlobWithProxy } from '../../utils/browserImageLoader.mjs';
import { resolvePublicAssetUrl } from '../../utils/modelAssetUrl.mjs';
import { moveProductReplaceRegion, normalizeProductReplaceRegion } from '../../utils/productReplaceRegion.mjs';

export type ProductReplaceRegionGroup = {
  id: string;
  productNumber: number;
  label: string;
  thumbnailUrl?: string;
};

type ProductReplaceRegion = {
  version: 1;
  source: 'manual';
  regionId: string;
  regionIndex: number;
  productGroupId: string;
  productNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

type RegionInteraction = {
  mode: 'draw' | 'move';
  regionIndex: number;
  startX: number;
  startY: number;
  origin?: ProductReplaceRegion;
  changed: boolean;
};

type Props = {
  open: boolean;
  reference?: Material;
  groups: ProductReplaceRegionGroup[];
  initialRegions?: Array<Record<string, unknown>>;
  onClose: () => void;
  onSave: (regions: ProductReplaceRegion[]) => void;
};

const EMPTY_PRODUCT_REPLACE_REGIONS: Array<Record<string, unknown>> = [];

const AuthenticatedPreviewImage: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement> & { sourceUrl?: string }
> = ({ sourceUrl, ...imageProps }) => {
  const safeUrl = String(sourceUrl || '').trim();
  const directUrl = safeUrl.startsWith('blob:') || safeUrl.startsWith('data:') ? safeUrl : '';
  const [fetchedPreview, setFetchedPreview] = useState({ sourceUrl: '', objectUrl: '' });

  useEffect(() => {
    if (!safeUrl || directUrl) return undefined;

    const controller = new AbortController();
    let objectUrl = '';
    let cancelled = false;
    const fetchUrl = resolvePublicAssetUrl(safeUrl) || safeUrl;
    void fetchImageBlobWithProxy(fetchUrl, 'Product replacement preview', controller.signal)
      .then((blob: Blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFetchedPreview({ sourceUrl: safeUrl, objectUrl });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [directUrl, safeUrl]);

  const resolvedUrl = directUrl || (fetchedPreview.sourceUrl === safeUrl ? fetchedPreview.objectUrl : '');
  return <img {...imageProps} src={resolvedUrl || undefined} />;
};

const buildDefaultRegion = (group: ProductReplaceRegionGroup, index: number): ProductReplaceRegion => {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    version: 1,
    source: 'manual',
    regionId: `product-replace-region-${group.productNumber}`,
    regionIndex: group.productNumber,
    productGroupId: group.id,
    productNumber: group.productNumber,
    xRatio: Math.min(0.7, 0.06 + column * 0.3),
    yRatio: Math.min(0.7, 0.08 + row * 0.28),
    widthRatio: 0.24,
    heightRatio: 0.24,
  };
};

const normalizeInitialRegions = (
  groups: ProductReplaceRegionGroup[],
  initialRegions: Array<Record<string, unknown>>,
) => {
  const byGroupId = new Map(
    initialRegions
      .map((region) => normalizeProductReplaceRegion(region))
      .filter(Boolean)
      .map((region) => [region.productGroupId, region]),
  );
  return groups.map((group, index) => {
    const saved = byGroupId.get(group.id);
    return saved && saved.productNumber === group.productNumber
      ? saved as ProductReplaceRegion
      : buildDefaultRegion(group, index);
  });
};

const collectSavedGroupIds = (
  groups: ProductReplaceRegionGroup[],
  initialRegions: Array<Record<string, unknown>>,
) => new Set(
  initialRegions
    .map((region) => normalizeProductReplaceRegion(region))
    .filter(Boolean)
    .map((region) => region.productGroupId)
    .filter((id) => groups.some((group) => group.id === id)),
);

const ProductReplaceRegionEditor: React.FC<Props> = ({
  open,
  reference,
  groups,
  initialRegions = EMPTY_PRODUCT_REPLACE_REGIONS,
  onClose,
  onSave,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<RegionInteraction | null>(null);
  const [regions, setRegions] = useState<ProductReplaceRegion[]>(() => normalizeInitialRegions(groups, initialRegions));
  const [activeGroupId, setActiveGroupId] = useState(() => groups[0]?.id || '');
  const [markedGroupIds, setMarkedGroupIds] = useState<Set<string>>(() => collectSavedGroupIds(groups, initialRegions));
  const [validationMessage, setValidationMessage] = useState('');

  const activeIndex = Math.max(0, groups.findIndex((group) => group.id === activeGroupId));
  const referenceRatio = (reference?.originalWidth || 1000) / Math.max(1, reference?.originalHeight || 1000);
  const allMarked = groups.length > 0 && groups.every((group) => markedGroupIds.has(group.id));
  const markedCount = useMemo(
    () => groups.filter((group) => markedGroupIds.has(group.id)).length,
    [groups, markedGroupIds],
  );

  if (!open || !reference) return null;

  const pointerPosition = (event: React.PointerEvent<HTMLElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { xRatio: 0, yRatio: 0 };
    return {
      xRatio: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      yRatio: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const updateRegion = (regionIndex: number, patch: Partial<ProductReplaceRegion>) => {
    setRegions((current) => current.map((region, index) => (
      index === regionIndex ? { ...region, ...patch } : region
    )));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-product-region-control="true"]')) return;
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    const position = pointerPosition(event);
    interactionRef.current = {
      mode: 'draw',
      regionIndex: activeIndex,
      startX: position.xRatio,
      startY: position.yRatio,
      changed: true,
    };
    updateRegion(activeIndex, {
      xRatio: position.xRatio,
      yRatio: position.yRatio,
      widthRatio: 0.02,
      heightRatio: 0.02,
    });
    setValidationMessage('');
  };

  const handleRegionPointerDown = (event: React.PointerEvent<HTMLButtonElement>, regionIndex: number) => {
    const region = regions[regionIndex];
    if (!region) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current;
    frame?.setPointerCapture?.(event.pointerId);
    const position = pointerPosition(event);
    interactionRef.current = {
      mode: 'move',
      regionIndex,
      startX: position.xRatio,
      startY: position.yRatio,
      origin: { ...region },
      changed: false,
    };
    setActiveGroupId(region.productGroupId);
    setValidationMessage('');
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    event.preventDefault();
    const position = pointerPosition(event);
    if (interaction.mode === 'move' && interaction.origin) {
      const deltaX = position.xRatio - interaction.startX;
      const deltaY = position.yRatio - interaction.startY;
      if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) interaction.changed = true;
      const moved = moveProductReplaceRegion(interaction.origin, deltaX, deltaY);
      if (moved) {
        updateRegion(interaction.regionIndex, {
          xRatio: moved.xRatio,
          yRatio: moved.yRatio,
        });
      }
      return;
    }

    const xRatio = Math.min(interaction.startX, position.xRatio);
    const yRatio = Math.min(interaction.startY, position.yRatio);
    updateRegion(interaction.regionIndex, {
      xRatio,
      yRatio,
      widthRatio: Math.min(Math.max(0.02, Math.abs(position.xRatio - interaction.startX)), 1 - xRatio),
      heightRatio: Math.min(Math.max(0.02, Math.abs(position.yRatio - interaction.startY)), 1 - yRatio),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    event.preventDefault();
    interactionRef.current = null;
    const group = groups[interaction.regionIndex];
    if (group && interaction.changed) {
      setMarkedGroupIds((current) => new Set([...current, group.id]));
    }
  };

  const handlePointerCancel = () => {
    interactionRef.current = null;
  };

  const save = () => {
    if (!allMarked) {
      setValidationMessage('每张替换参考图都必须完成全部产品区域标记。');
      return;
    }
    const normalized = regions
      .map((region) => normalizeProductReplaceRegion(region))
      .filter(Boolean) as ProductReplaceRegion[];
    if (normalized.length !== groups.length) {
      setValidationMessage('产品位置区域无效，请重新框选。');
      return;
    }
    onSave(normalized);
  };

  return (
    <div
      className="fixed inset-0 z-[284] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.76)', backdropFilter: 'blur(10px)' }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-3xl border"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>产品替换区域标记</h3>
            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
              在参考图上为每个产品组标记对应原产品；标记只用于定位，不会进入最终成图。
            </p>
            <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {reference.fileName || '替换参考图'} · 已标记 {markedCount}/{groups.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ color: 'var(--text-tertiary)', background: 'var(--bg-elevated)' }}
            title="关闭"
            aria-label="关闭产品位置标记"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            {groups.map((group) => {
              const active = group.id === activeGroupId;
              const marked = markedGroupIds.has(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setActiveGroupId(group.id);
                    setValidationMessage('');
                  }}
                  className="flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left"
                  style={{
                    borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                    background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {group.thumbnailUrl ? (
                    <AuthenticatedPreviewImage
                      sourceUrl={group.thumbnailUrl}
                      alt=""
                      className="h-8 w-8 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                      <MapPin size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold">P{group.productNumber}</span>
                    <span className="block truncate text-[10px]">{group.label}</span>
                  </span>
                  {marked ? <Check size={15} /> : <MapPin size={15} />}
                </button>
              );
            })}
            {validationMessage ? (
              <p className="mt-2 text-[11px] leading-5 text-red-500">{validationMessage}</p>
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                当前标记：P{groups[activeIndex]?.productNumber || 1}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>拖动标记框调整位置；在空白处拖拽重新框选</span>
            </div>
            <div className="flex justify-center rounded-2xl p-3" style={{ height: 'min(64vh, 700px)', background: 'var(--bg-elevated)' }}>
              <div
                ref={frameRef}
                className="relative overflow-hidden rounded-xl border"
                style={{
                  aspectRatio: `${reference.originalWidth || 1000} / ${reference.originalHeight || 1000}`,
                  width: referenceRatio >= 1 ? '100%' : `calc(min(64vh, 700px) * ${referenceRatio})`,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  touchAction: 'none',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                >
                <AuthenticatedPreviewImage
                  sourceUrl={reference.url}
                  alt="组合产品替换参考图"
                  className="h-full w-full select-none object-contain"
                  draggable={false}
                />
                {regions.map((region, index) => {
                  const active = groups[index]?.id === activeGroupId;
                  const marked = markedGroupIds.has(region.productGroupId);
                  return (
                    <button
                      key={region.productGroupId}
                      type="button"
                      data-product-region-control="true"
                      aria-label={`拖动 P${region.productNumber} 标记框调整位置`}
                      title={`拖动 P${region.productNumber} 标记框调整位置`}
                      onPointerDown={(event) => handleRegionPointerDown(event, index)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveGroupId(region.productGroupId);
                      }}
                      className="absolute rounded-md border-2 text-[10px] font-semibold text-white"
                      style={{
                        left: `${region.xRatio * 100}%`,
                        top: `${region.yRatio * 100}%`,
                        width: `${region.widthRatio * 100}%`,
                        height: `${region.heightRatio * 100}%`,
                        borderColor: active ? '#2563eb' : marked ? '#16a34a' : '#94a3b8',
                        background: active ? 'rgba(37,99,235,0.16)' : marked ? 'rgba(22,163,74,0.12)' : 'rgba(148,163,184,0.10)',
                        cursor: 'move',
                      }}
                    >
                      <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5">
                        P{region.productNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[12px] font-medium"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Check size={14} /> 保存区域标记
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductReplaceRegionEditor;
