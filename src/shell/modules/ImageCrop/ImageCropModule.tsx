import React, { useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Plus, ScissorsLineDashed, Trash2, UploadCloud, X } from 'lucide-react';
import type { GeneratedResult, Project, SubFeatureOption, Task } from '../../../ShellMigratedApp';
import type { AppModule } from '../../../types';
import { AppModuleObj } from '../../../types';
import ProjectListView from '../../components/ProjectListView';
import { useToast } from '../../components/ToastSystem';
import { createZipAndDownload } from '../../../utils/imageUtils';
import { safeCreateObjectURL } from '../../../utils/urlUtils';
import { buildSliceRanges, buildVisibleAreaSplitLine, sliceImageFile, type ImageSliceBlob } from '../../../modules/ImageCrop/imageSliceUtils';
import { calculateContainedResize, resizeImageFile, type ImageResizeBlob } from '../../../modules/ImageCrop/imageResizeUtils';

interface Props {
  projects: Project[];
  tasks: Task[];
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  onUploadSliceAsset: (file: File) => Promise<{ fileUrl: string; assetId?: string }>;
  onPersistProject: (project: Project) => Promise<boolean> | void;
  onDeleteUploadedAsset?: (fileUrl: string) => void;
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onCancelTask: (taskId: string) => void;
  pendingActionKeys?: Record<string, boolean>;
}

interface SourceImageState {
  file: File;
  objectUrl: string;
  width: number;
  height: number;
}

const formatPixels = (value: number) => `${Math.round(value)} px`;

const loadSourceImage = async (file: File): Promise<SourceImageState> => {
  const objectUrl = safeCreateObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return {
      file,
      objectUrl,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const makeResult = (
  projectId: string,
  module: AppModule,
  slice: ImageSliceBlob,
  uploadedUrl: string,
  source: SourceImageState,
  total: number,
  createdAt: number,
): GeneratedResult => ({
  id: `${projectId}-slice-${String(slice.index + 1).padStart(3, '0')}`,
  projectId,
  imageUrl: uploadedUrl,
  mediaType: 'image',
  prompt: `长图切片 ${slice.index + 1}/${total} · y=${slice.y} · h=${slice.height}`,
  model: 'local-canvas',
  aspectRatio: `${slice.width}:${slice.height}`,
  status: 'completed',
  createdAt,
  module,
  subFeature: 'long_slice',
  fileName: slice.fileName,
  relativePath: slice.fileName,
  batchIndex: slice.index,
  originalWidth: source.width,
  originalHeight: source.height,
});

const makeResizeResult = (
  projectId: string,
  module: AppModule,
  resize: ImageResizeBlob,
  uploadedUrl: string,
  source: SourceImageState,
  index: number,
  createdAt: number,
): GeneratedResult => ({
  id: `${projectId}-resize-${String(index + 1).padStart(3, '0')}`,
  projectId,
  imageUrl: uploadedUrl,
  mediaType: 'image',
  prompt: `修改尺寸 · ${source.width}x${source.height} → ${resize.width}x${resize.height} · 等比例缩放`,
  model: 'local-canvas',
  aspectRatio: `${resize.width}:${resize.height}`,
  status: 'completed',
  createdAt,
  module,
  subFeature: 'resize',
  fileName: resize.fileName,
  relativePath: resize.fileName,
  batchIndex: index,
  originalWidth: source.width,
  originalHeight: source.height,
});

const ImageCropModule: React.FC<Props> = ({
  projects,
  tasks,
  subFeatures,
  activeSubFeature,
  onSubFeatureChange,
  onUploadSliceAsset,
  onPersistProject,
  onDeleteUploadedAsset,
  onDeleteResult,
  onDeleteProject,
  onCancelTask,
  pendingActionKeys,
}) => {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollFrameRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<SourceImageState | null>(null);
  const [splitLines, setSplitLines] = useState<number[]>([]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [localSlices, setLocalSlices] = useState<ImageSliceBlob[]>([]);
  const [resizeSources, setResizeSources] = useState<SourceImageState[]>([]);
  const [targetWidth, setTargetWidth] = useState('800');
  const [targetHeight, setTargetHeight] = useState('800');
  const [localResizes, setLocalResizes] = useState<ImageResizeBlob[]>([]);

  const isResizeMode = activeSubFeature === 'resize';

  const ranges = useMemo(() => source ? buildSliceRanges(source.height, splitLines) : [], [source, splitLines]);

  const clampSplitLine = (value: number, otherLines: number[] = []) => {
    if (!source) return Math.round(value);
    const minSliceHeight = 16;
    const currentY = Math.round(value);
    const sortedOtherLines = [...otherLines].sort((a, b) => a - b);
    const previousLine = sortedOtherLines.filter((line) => line < currentY).at(-1) ?? 0;
    const nextLine = sortedOtherLines.find((line) => line > currentY) ?? source.height;
    const lower = previousLine + minSliceHeight;
    const upper = nextLine - minSliceHeight;

    if (upper < lower) return currentY;
    return Math.min(upper, Math.max(lower, currentY));
  };

  const resetSource = () => {
    if (source?.objectUrl) URL.revokeObjectURL(source.objectUrl);
    localSlices.forEach((slice) => URL.revokeObjectURL((slice as ImageSliceBlob & { previewUrl?: string }).previewUrl || ''));
    setSource(null);
    setSplitLines([]);
    setLocalSlices([]);
    setDraggingIndex(null);
  };

  const resetResizeSources = () => {
    resizeSources.forEach((item) => URL.revokeObjectURL(item.objectUrl));
    setResizeSources([]);
    setLocalResizes([]);
  };

  const handleFileSelected = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('请上传图片文件。', 'warning');
      return;
    }
    resetSource();
    try {
      const next = await loadSourceImage(file);
      setSource(next);
      addToast('长图已载入，可添加并拖动横向分割线。', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '图片读取失败', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResizeFilesSelected = async (files: FileList | null) => {
    const selectedFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (selectedFiles.length === 0) {
      addToast('请上传图片文件。', 'warning');
      return;
    }
    resetResizeSources();
    try {
      const nextSources = await Promise.all(selectedFiles.map((file) => loadSourceImage(file)));
      setResizeSources(nextSources);
      setLocalResizes([]);
      addToast(`已载入 ${nextSources.length} 张图片，可输入目标尺寸后生成。`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '图片读取失败', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResizeGenerate = async () => {
    if (resizeSources.length === 0) {
      addToast('请先上传需要修改尺寸的图片。', 'warning');
      return;
    }
    const width = Number(targetWidth);
    const height = Number(targetHeight);
    if (!width && !height) {
      addToast('请至少填写目标宽度或目标高度。', 'warning');
      return;
    }
    setIsGenerating(true);
    const uploadedUrls: string[] = [];
    try {
      const resized = await Promise.all(resizeSources.map((item) => (
        resizeImageFile(item.file, width, height, { mimeType: item.file.type === 'image/png' || item.file.type === 'image/webp' ? item.file.type : 'image/jpeg' })
      )));
      const uploaded = [];
      for (const item of resized) {
        const file = new File([item.blob], item.fileName, { type: item.mimeType });
        const upload = await onUploadSliceAsset(file);
        if (upload.fileUrl) uploadedUrls.push(upload.fileUrl);
        uploaded.push(upload);
      }
      const createdAt = Date.now();
      const projectId = `image-resize-${Date.now()}`;
      const results = resized.map((item, index) => (
        makeResizeResult(projectId, AppModuleObj.IMAGE_CROP as AppModule, item, uploaded[index].fileUrl, resizeSources[index], index, createdAt)
      ));
      const project: Project = {
        id: projectId,
        name: `修改尺寸 - ${resizeSources.length === 1 ? resizeSources[0].file.name : `${resizeSources.length} 张图片`}`,
        module: AppModuleObj.IMAGE_CROP,
        status: 'completed',
        createdAt,
        completedAt: createdAt,
        createdAtPrecise: true,
        results,
        taskCount: resized.length,
        completedCount: resized.length,
        subFeature: 'resize',
        directGeneration: true,
      };
      setLocalResizes(resized);
      const resizePersisted = await onPersistProject(project);
      const resizeHistorySaved = resizePersisted !== false;
      addToast(
        resizeHistorySaved ? `已等比例缩放 ${resized.length} 张图片并保存历史记录。` : '图片已生成，但历史记录保存失败，请先下载本次 ZIP。',
        resizeHistorySaved ? 'success' : 'warning',
      );
    } catch (error) {
      uploadedUrls.forEach((url) => onDeleteUploadedAsset?.(url));
      addToast(error instanceof Error ? error.message : '修改尺寸失败', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const clientYToImageY = (clientY: number) => {
    if (!source || !previewRef.current) return 0;
    const rect = previewRef.current.getBoundingClientRect();
    const ratio = source.height / Math.max(1, rect.height);
    return Math.round((clientY - rect.top) * ratio);
  };

  const setLineAtIndex = (index: number, nextY: number) => {
    if (!source) return;
    setSplitLines((current) => {
      const next = [...current];
      next[index] = clampSplitLine(nextY, next.filter((_, itemIndex) => itemIndex !== index));
      return next;
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIndex === null) return;
    event.preventDefault();
    setLineAtIndex(draggingIndex, clientYToImageY(event.clientY));
  };

  const addSplitLine = () => {
    if (!source) {
      addToast('请先上传详情长图。', 'warning');
      return;
    }
    const scrollFrame = scrollFrameRef.current;
    const preview = previewRef.current;
    const candidate = scrollFrame && preview
      ? buildVisibleAreaSplitLine({
          imageHeight: source.height,
          viewportHeight: scrollFrame.clientHeight,
          renderedHeight: preview.getBoundingClientRect().height,
          scrollTop: scrollFrame.scrollTop,
        })
      : Math.round(source.height / 2);
    let targetLine = candidate;
    setSplitLines((current) => {
      const clampedCandidate = clampSplitLine(candidate, current);
      targetLine = clampedCandidate;
      return [...current, clampedCandidate].sort((a, b) => a - b);
    });
    window.setTimeout(() => {
      if (!scrollFrame || !preview) return;
      const targetTop = (targetLine / source.height) * preview.getBoundingClientRect().height;
      scrollFrame.scrollTo({ top: Math.max(0, targetTop - scrollFrame.clientHeight / 2), behavior: 'smooth' });
    }, 0);
  };

  const removeSplitLine = (index: number) => {
    setSplitLines((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleGenerate = async () => {
    if (!source) {
      addToast('请先上传详情长图。', 'warning');
      return;
    }
    if (splitLines.length === 0) {
      addToast('请至少添加一条横向分割线。', 'warning');
      return;
    }
    setIsGenerating(true);
    const uploadedUrls: string[] = [];
    try {
      const slices = await sliceImageFile(source.file, splitLines, { mimeType: source.file.type === 'image/png' ? 'image/png' : 'image/jpeg' });
      const uploaded = [];
      for (const slice of slices) {
        const file = new File([slice.blob], slice.fileName, { type: slice.mimeType });
        const upload = await onUploadSliceAsset(file);
        if (upload.fileUrl) uploadedUrls.push(upload.fileUrl);
        uploaded.push(upload);
      }
      const createdAt = Date.now();
      const projectId = `image-crop-${Date.now()}`;
      const results = slices.map((slice, index) => (
        makeResult(projectId, AppModuleObj.IMAGE_CROP as AppModule, slice, uploaded[index].fileUrl, source, slices.length, createdAt)
      ));
      const project: Project = {
        id: projectId,
        name: `长图切片 - ${source.file.name}`,
        module: AppModuleObj.IMAGE_CROP,
        status: 'completed',
        createdAt,
        completedAt: createdAt,
        createdAtPrecise: true,
        results,
        taskCount: slices.length,
        completedCount: slices.length,
        subFeature: 'long_slice',
        directGeneration: true,
      };
      setLocalSlices(slices);
      const slicePersisted = await onPersistProject(project);
      const sliceHistorySaved = slicePersisted !== false;
      addToast(
        sliceHistorySaved ? `已生成 ${slices.length} 张切片并保存历史记录。` : '切片已生成，但历史记录保存失败，请先下载本次 ZIP。',
        sliceHistorySaved ? 'success' : 'warning',
      );
    } catch (error) {
      uploadedUrls.forEach((url) => onDeleteUploadedAsset?.(url));
      addToast(error instanceof Error ? error.message : '长图切片失败', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadLocalZip = async () => {
    if (localSlices.length === 0) {
      addToast('当前还没有本地切片结果。', 'warning');
      return;
    }
    await createZipAndDownload(
      localSlices.map((slice) => ({ blob: slice.blob, path: slice.fileName })),
      'long-image-slices',
    );
  };

  const downloadResizeLocalZip = async () => {
    if (localResizes.length === 0) {
      addToast('当前还没有本地改尺寸结果。', 'warning');
      return;
    }
    await createZipAndDownload(
      localResizes.map((item) => ({ blob: item.blob, path: item.fileName })),
      'image-resize-results',
    );
  };

  const renderResizeWorkspace = () => (
    <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>修改尺寸工作台</h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>上传图片后输入目标宽高，系统会按等比例缩放输出，不会拉伸变形。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleResizeFilesSelected(event.target.files)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
              <UploadCloud size={14} />
              上传图片
            </button>
            {resizeSources.length > 0 && (
              <button type="button" onClick={resetResizeSources} className="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <X size={14} />
                清空
              </button>
            )}
          </div>
        </div>

        {resizeSources.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {resizeSources.map((item) => {
              const estimated = (() => {
                try {
                  return calculateContainedResize(item.width, item.height, Number(targetWidth), Number(targetHeight));
                } catch {
                  return null;
                }
              })();
              return (
                <div key={`${item.file.name}-${item.objectUrl}`} className="overflow-hidden rounded-[8px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <div className="flex h-[160px] items-center justify-center">
                    <img src={item.objectUrl} alt={item.file.name} className="h-full w-full object-contain" />
                  </div>
                  <div className="border-t p-2 text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{item.file.name}</div>
                    <div className="mt-1 flex justify-between gap-2">
                      <span>原图 {item.width} x {item.height}</span>
                      <span>{estimated ? `输出 ${estimated.width} x ${estimated.height}` : '待填写尺寸'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[300px] w-full flex-col items-center justify-center rounded-[8px] border border-dashed transition-colors"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)', background: 'var(--bg-base)' }}
          >
            <ImagePlus size={34} strokeWidth={1.4} />
            <span className="mt-3 text-[13px] font-semibold">点击上传需要修改尺寸的图片</span>
          </button>
        )}
      </div>

      <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>等比例缩放</h3>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>图片会被缩放到目标范围内，保留原始比例。</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            目标宽度
            <input value={targetWidth} onChange={(event) => setTargetWidth(event.target.value)} inputMode="numeric" className="mt-1 h-10 w-full rounded-[8px] border bg-transparent px-3 text-[13px] outline-none" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
          </label>
          <label className="block text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            目标高度
            <input value={targetHeight} onChange={(event) => setTargetHeight(event.target.value)} inputMode="numeric" className="mt-1 h-10 w-full rounded-[8px] border bg-transparent px-3 text-[13px] outline-none" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            ['800', '800'],
            ['1000', '1000'],
            ['1200', '1200'],
            ['750', ''],
          ].map(([width, height]) => (
            <button key={`${width}-${height}`} type="button" onClick={() => { setTargetWidth(width); setTargetHeight(height); }} className="h-8 rounded-full border text-[11px] font-medium" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {width || '自动'} x {height || '自动'}
            </button>
          ))}
        </div>
        <button type="button" onClick={handleResizeGenerate} disabled={resizeSources.length === 0 || isGenerating} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--accent)' }}>
          {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <ScissorsLineDashed size={15} />}
          生成并保存
        </button>
        <button type="button" onClick={downloadResizeLocalZip} disabled={localResizes.length === 0} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <Download size={14} />
          下载本次 ZIP
        </button>
      </div>
    </div>
  );

  const renderSliceWorkspace = () => (
    <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>长图切片工作台</h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>上传详情长图后，添加并拖动横向分割线，生成多张短图并保存到历史记录。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleFileSelected(event.target.files)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
              <UploadCloud size={14} />
              上传长图
            </button>
            {source && (
              <button type="button" onClick={resetSource} className="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <X size={14} />
                清空
              </button>
            )}
          </div>
        </div>

        {source ? (
          <div ref={scrollFrameRef} className="max-h-[62vh] overflow-auto rounded-[8px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
            <div
              ref={previewRef}
              className="relative mx-auto"
              style={{ width: 'min(100%, 760px)' }}
              onPointerMove={handlePointerMove}
              onPointerUp={() => {
                setDraggingIndex(null);
                setSplitLines((current) => [...current].sort((a, b) => a - b));
              }}
              onPointerCancel={() => {
                setDraggingIndex(null);
                setSplitLines((current) => [...current].sort((a, b) => a - b));
              }}
              onPointerLeave={() => {
                setDraggingIndex(null);
                setSplitLines((current) => [...current].sort((a, b) => a - b));
              }}
            >
              <img src={source.objectUrl} alt="待切片长图预览" className="block h-auto w-full select-none" draggable={false} />
              {splitLines.map((line, index) => {
                const top = `${(line / source.height) * 100}%`;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={`${line}-${index}`}
                    className="absolute left-0 right-0 z-10 block h-10 cursor-row-resize touch-none border-0 bg-transparent p-0"
                    style={{ top, transform: 'translateY(-50%)' }}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDraggingIndex(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setLineAtIndex(index, line - 10);
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setLineAtIndex(index, line + 10);
                      }
                    }}
                  >
                    <span className="absolute left-0 right-0 top-1/2 h-[4px] -translate-y-1/2 border-y border-white bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.8)]" />
                    <span className="absolute left-0 right-0 top-1/2 border-t border-dashed border-white/90" />
                    <span className="absolute left-2 top-1/2 flex h-7 -translate-y-1/2 items-center rounded-full bg-rose-500 px-2 text-[10px] font-semibold text-white shadow">
                      第 {index + 1} 条 · {formatPixels(line)}
                    </span>
                    <span
                      className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 shadow"
                      aria-hidden="true"
                    />
                    <span className="absolute left-1/2 top-1/2 h-[2px] w-3 -translate-x-1/2 -translate-y-1/2 bg-white" aria-hidden="true" />
                    <span
                      className="absolute left-1/2 top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-white"
                      aria-hidden="true"
                    />
                    <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSplitLine(index);
                        }}
                        className="flex h-7 items-center gap-1 rounded-full bg-slate-950/80 px-2 text-[10px] font-semibold text-white shadow"
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[340px] w-full flex-col items-center justify-center rounded-[8px] border border-dashed transition-colors"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)', background: 'var(--bg-base)' }}
          >
            <ImagePlus size={34} strokeWidth={1.4} />
            <span className="mt-3 text-[13px] font-semibold">点击上传详情长图</span>
          </button>
        )}
      </div>

      <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>分割线</h3>
        <div className="mt-3 space-y-2">
          <button type="button" onClick={addSplitLine} disabled={!source || isGenerating} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <Plus size={14} />
            添加横向分割线
          </button>
          <button type="button" onClick={() => setSplitLines([])} disabled={!source || splitLines.length === 0 || isGenerating} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <Trash2 size={14} />
            清空分割线
          </button>
        </div>

        <div className="mt-4 rounded-[8px] p-3" style={{ background: 'var(--bg-base)' }}>
          <div className="grid grid-cols-2 gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <span>原图尺寸</span>
            <strong className="text-right" style={{ color: 'var(--text-primary)' }}>{source ? `${source.width} x ${source.height}` : '-'}</strong>
            <span>切片数量</span>
            <strong className="text-right" style={{ color: 'var(--text-primary)' }}>{source ? ranges.length : 0}</strong>
          </div>
          {ranges.length > 0 && (
            <div className="mt-3 max-h-44 space-y-1 overflow-auto">
              {ranges.map((range) => (
                <div key={range.index} className="flex justify-between rounded-[6px] px-2 py-1 text-[11px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  <span>第 {range.index + 1} 段</span>
                  <span>{formatPixels(range.y)} - {formatPixels(range.y + range.height)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="button" onClick={handleGenerate} disabled={!source || splitLines.length === 0 || isGenerating} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--accent)' }}>
          {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <ScissorsLineDashed size={15} />}
          生成切片并保存
        </button>
        <button type="button" onClick={downloadLocalZip} disabled={localSlices.length === 0} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <Download size={14} />
          下载本次 ZIP
        </button>
      </div>
    </div>
  );

  return (
    <ProjectListView
      projects={projects}
      tasks={tasks}
      title="图片裁切"
      description={isResizeMode ? '本地等比例修改图片尺寸，生成结果并保存历史记录' : '本地裁切详情长图，生成短图并保存历史记录'}
      emptyIcon={<ScissorsLineDashed size={30} strokeWidth={1.4} />}
      emptyTitle={isResizeMode ? '还没有修改尺寸记录' : '还没有长图切片记录'}
      emptySubtitle={isResizeMode ? '上传图片，输入目标宽高后等比例生成新尺寸。' : '上传详情长图，手动拖动横向分割线后生成切片。'}
      subFeatures={subFeatures}
      activeSubFeature={activeSubFeature}
      onSubFeatureChange={onSubFeatureChange}
      beforeProjects={isResizeMode ? renderResizeWorkspace() : renderSliceWorkspace()}
      onDeleteResult={onDeleteResult}
      onDeleteProject={onDeleteProject}
      onCancelTask={onCancelTask}
      pendingActionKeys={pendingActionKeys}
      showGenerationProgress={false}
    />
  );
};

export default ImageCropModule;
