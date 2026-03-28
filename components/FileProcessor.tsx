
import React, { useRef, useState, useEffect } from 'react';
import { FileItem, ModuleConfig, GlobalApiConfig, AspectRatio, AppModule, TranslationSubMode, KieAiResult } from '../types';
import { releaseObjectURLs, safeCreateObjectURL } from '../utils/urlUtils';
import { normalizeFetchedImageBlob } from '../utils/imageBlobUtils.mjs';
import { uploadToCos } from '../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../services/kieAiService';
import { resizeImage, createZipAndDownload, getImageDimensions, getImageDimensionsFromUrl, fileToDataUrl } from '../utils/imageUtils';
import ComparisonModal from './ComparisonModal';
import { logActionFailure, logActionInterrupted, logActionStart, logActionSuccess } from '../services/loggingService';
import { shouldValidateTranslationAspectRatio } from '../modules/Translation/translationConfigUtils.mjs';
import { deriveTranslationExecutionPlan, deriveTranslationExportSize, getStoredSourceDimensions } from '../modules/Translation/translationProcessingUtils.mjs';

interface Props {
  activeModule: AppModule;
  subMode?: TranslationSubMode;
  apiConfig: GlobalApiConfig;
  config: ModuleConfig;
  files: FileItem[];
  onFilesChange: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
  isProcessing: boolean;
  onProcessingChange: (processing: boolean) => void;
  startSignal?: number;
}

const FileProcessor: React.FC<Props> = ({ 
  activeModule, subMode, apiConfig, config, 
  files, onFilesChange, isProcessing, onProcessingChange, startSignal = 0
}) => {
  const nanoBanana2Ratios: AspectRatio[] = [
    AspectRatio.SQUARE,
    AspectRatio.P_1_4,
    AspectRatio.P_1_8,
    AspectRatio.P_2_3,
    AspectRatio.L_3_2,
    AspectRatio.P_3_4,
    AspectRatio.L_4_1,
    AspectRatio.L_4_3,
    AspectRatio.P_4_5,
    AspectRatio.L_5_4,
    AspectRatio.L_8_1,
    AspectRatio.P_9_16,
    AspectRatio.L_16_9,
    AspectRatio.L_21_9,
  ];
  const nanoBananaProRatios: AspectRatio[] = [
    AspectRatio.SQUARE,
    AspectRatio.P_2_3,
    AspectRatio.L_3_2,
    AspectRatio.P_3_4,
    AspectRatio.L_4_3,
    AspectRatio.P_4_5,
    AspectRatio.L_5_4,
    AspectRatio.P_9_16,
    AspectRatio.L_16_9,
    AspectRatio.L_21_9,
  ];

  const formatRatioLabel = (width: number, height: number) => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  };

  const getClosestSupportedAspectRatio = (width: number, height: number, model: string): AspectRatio => {
    if (!width || !height) return AspectRatio.P_3_4;

    const supportedRatios = model === 'nano-banana-pro' ? nanoBananaProRatios : nanoBanana2Ratios;
    const sourceRatio = width / height;
    let closestRatio = supportedRatios[0];
    let closestDelta = Infinity;

    supportedRatios.forEach((ratio) => {
      const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
      const ratioValue = ratioWidth / ratioHeight;
      const delta = Math.abs(sourceRatio - ratioValue);
      if (delta < closestDelta) {
        closestDelta = delta;
        closestRatio = ratio;
      }
    });

    return closestRatio;
  };

  const buildUniqueUploadName = (item: FileItem): string => {
    const originalName = item.file?.name || item.relativePath.split(/[\\/]/).pop() || 'image.png';
    const extensionIndex = originalName.lastIndexOf('.');
    const extension = extensionIndex >= 0 ? originalName.slice(extensionIndex) : '';
    const baseName = extensionIndex >= 0 ? originalName.slice(0, extensionIndex) : originalName;
    const folderFingerprint = item.relativePath
      .replace(/[\\/]/g, '__')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .slice(0, 80);

    return `${folderFingerprint}__${item.id}__${baseName}${extension || '.png'}`;
  };

  const normalizeZipPath = (relativePath: string): string => relativePath.replace(/\\/g, '/');

  const [selectedItem, setSelectedItem] = useState<FileItem | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const controllersRef = useRef<Record<string, AbortController>>({});
  const activeJobsRef = useRef(0);
  const pendingQueueRef = useRef<string[]>([]);
  const submissionLockRef = useRef(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isDetailMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.DETAIL;
  const isRemoveTextMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.REMOVE_TEXT;
  const translationModeLabel = isDetailMode ? '详情出海' : isRemoveTextMode ? '去除文案' : '主图出海';
  const baseMeta = {
    subMode: subMode || 'main',
    model: config.model,
    quality: config.quality,
    aspectRatio: config.aspectRatio,
  };

  const filesRef = useRef(files);
  filesRef.current = files;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selectedFiles = Array.from(e.target.files) as File[];
    
    const validItems: FileItem[] = [];
    let hasViolation = false;

    for (const f of selectedFiles) {
      if (!f.type.startsWith('image/')) continue;
      let sourceDimensions: { width: number; height: number; ratio: number } | null = null;
      
      if (isDetailMode) {
        sourceDimensions = await getImageDimensions(f);
        if (sourceDimensions.height > sourceDimensions.width * 4) {
          hasViolation = true;
          continue; 
        }
      }

      const relativePath = (f as any).webkitRelativePath || f.name;
      const sourcePreviewUrl = await fileToDataUrl(f);

      validItems.push({
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        relativePath: relativePath,
        originalWidth: sourceDimensions?.width || undefined,
        originalHeight: sourceDimensions?.height || undefined,
        sourcePreviewUrl,
        status: 'pending',
        progress: 0
      });
    }

    if (hasViolation) {
      setAlertMessage('部分详情图比例超过 1:4，建议切片后上传以保证生成质量。');
    }

    onFilesChange(prev => Array.isArray(prev) ? [...prev, ...validItems] : [...files, ...validItems]);
    void logActionSuccess({
      module: 'translation',
      action: ((selectedFiles[0] as any)?.webkitRelativePath ? 'import_folder' : 'import_files'),
      message: `导入${(selectedFiles[0] as any)?.webkitRelativePath ? '文件夹' : '图片'}成功`,
      meta: {
        ...baseMeta,
        count: validItems.length,
      },
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const clearFiles = () => {
    if (isProcessing) return;
    releaseObjectURLs(files.flatMap((item) => [item.file, item.resultBlob]));
    void logActionSuccess({
      module: 'translation',
      action: 'clear_files',
      message: `清空${translationModeLabel}队列`,
      meta: {
        ...baseMeta,
        count: files.length,
      },
    });
    onFilesChange([]);
    controllersRef.current = {};
  };

  useEffect(() => {
    return () => {
      releaseObjectURLs(filesRef.current.flatMap((item) => [item.file, item.resultBlob]));
    };
  }, []);

  useEffect(() => {
    if (startSignal > 0) {
      startProcessing();
    }
  }, [startSignal]);

  const updateSingleFile = (id: string, updates: Partial<FileItem>) => {
    onFilesChange(prev => {
      const currentList = Array.isArray(prev) ? prev : filesRef.current;
      return currentList.map(f => f.id === id ? { ...f, ...updates } : f);
    });
  };

  const executeFileTask = async (fileId: string, mode: 'full' | 'recover' = 'full') => {
    const fileItem = filesRef.current.find(f => f.id === fileId);
    if (!fileItem) return;
    if (mode === 'full' && !fileItem.file) {
      updateSingleFile(fileId, {
        status: 'error',
        error: '原始文件已失效，请重新导入后再生成。',
        progress: 0,
      });
      return;
    }

    if (controllersRef.current[fileId]) {
      controllersRef.current[fileId].abort();
    }
    const controller = new AbortController();
    controllersRef.current[fileId] = controller;

    try {
      const taskStartedAt = Date.now();
      void logActionStart({
        module: 'translation',
        action: mode === 'recover' ? 'recover_single' : 'process_single',
        message: `${translationModeLabel}开始处理单张文件`,
        meta: {
          ...baseMeta,
          fileName: fileItem.file?.name || fileItem.relativePath,
          relativePath: fileItem.relativePath,
          taskId: fileItem.taskId,
        },
      });
      updateSingleFile(fileId, { 
        status: mode === 'recover' ? 'processing' : 'uploading', 
        progress: 10, 
        error: undefined 
      });

      let res: KieAiResult;
      const dimensions =
        getStoredSourceDimensions(fileItem) ||
        (fileItem.file
          ? await getImageDimensions(fileItem.file)
          : fileItem.sourcePreviewUrl
            ? await getImageDimensionsFromUrl(fileItem.sourcePreviewUrl)
            : { width: 0, height: 0, ratio: 1 });
      const { effectiveConfig, isRatioMatch } = deriveTranslationExecutionPlan({
        config,
        subMode: subMode || TranslationSubMode.MAIN,
      });

      if (mode === 'recover' && fileItem.taskId) {
        updateSingleFile(fileId, { progress: 20, error: '正在尝试获取图片结果...' });
        res = await recoverKieAiTask(fileItem.taskId, apiConfig, controller.signal);
      } else {
        const uploadStartedAt = Date.now();
        const cosUrl = await uploadToCos(
          fileItem.file!,
          apiConfig,
          buildUniqueUploadName(fileItem),
          {
            fileId,
            relativePath: fileItem.relativePath,
            originalFileName: fileItem.file?.name || fileItem.relativePath,
            subMode: subMode || TranslationSubMode.MAIN,
            taskStartedAt,
            uploadStartedAt,
          }
        );
        if (controller.signal.aborted) throw new Error("INTERRUPTED");

        updateSingleFile(fileId, { status: 'processing', progress: 30 });
        const providerSubmitStartedAt = Date.now();
        res = await processWithKieAi(
          cosUrl,
          apiConfig,
          effectiveConfig,
          isRatioMatch,
          controller.signal,
          undefined,
          isRemoveTextMode,
          isDetailMode ? {
            width: dimensions.width,
            height: dimensions.height,
            ratioLabel: formatRatioLabel(dimensions.width, dimensions.height)
          } : undefined,
          (subMode || TranslationSubMode.MAIN) as 'main' | 'detail' | 'remove_text'
        );
        void logActionSuccess({
          module: 'translation',
          action: 'provider_submitted',
          message: `${translationModeLabel}已提交生成任务`,
          meta: {
            ...baseMeta,
            fileName: fileItem.file?.name || fileItem.relativePath,
            relativePath: fileItem.relativePath,
            taskId: res.taskId,
            provider: 'kie',
            providerTaskId: res.taskId,
            providerSubmittedAt: Date.now(),
            providerSubmitStartedAt,
            providerSubmitDurationMs: Date.now() - providerSubmitStartedAt,
            taskStartedAt,
          },
        });
      }

      if (controller.signal.aborted || res.status === 'interrupted') throw new Error("INTERRUPTED");

      if (res.status === 'success') {
        updateSingleFile(fileId, { progress: 85, taskId: res.taskId });
        
        const response = await fetch(res.imageUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("获取生成图片失败");
        const blob = await normalizeFetchedImageBlob(await response.blob(), res.imageUrl);
        const generatedDimensions = await getImageDimensions(blob);
        const { targetWidth: targetW, targetHeight: targetH } = deriveTranslationExportSize({
          config,
          subMode: subMode || TranslationSubMode.MAIN,
          sourceDimensions: dimensions,
          generatedDimensions,
        });

        const finalBlob = await resizeImage(blob, targetW, targetH, config.maxFileSize);
        updateSingleFile(fileId, {
          status: 'completed',
          progress: 100,
          resultBlob: finalBlob,
          resultUrl: res.imageUrl,
          matchedAspectRatio: effectiveConfig.aspectRatio,
          taskId: res.taskId,
          error: undefined,
        });
        void logActionSuccess({
          module: 'translation',
          action: mode === 'recover' ? 'recover_single' : 'process_single',
          message: `${translationModeLabel}单张处理成功`,
          meta: {
            ...baseMeta,
            fileName: fileItem.file?.name || fileItem.relativePath,
            relativePath: fileItem.relativePath,
            matchedAspectRatio: effectiveConfig.aspectRatio,
            taskId: res.taskId,
            totalDurationMs: Date.now() - taskStartedAt,
          },
        });
      } else {
        throw new Error(res.message || (res.status === 'task_not_found' ? '任务已失效或不存在' : '处理异常'));
      }
    } catch (err: any) {
      const isInterrupt = err.message === 'INTERRUPTED' || err.name === 'AbortError' || controller.signal.aborted;
      updateSingleFile(fileId, { 
        status: isInterrupt ? 'interrupted' : 'error', 
        error: isInterrupt ? '已中断' : (err.message || '未知错误'), 
        progress: 0 
      });
      if (isInterrupt) {
        void logActionInterrupted({
          module: 'translation',
          action: mode === 'recover' ? 'recover_single' : 'process_single',
          message: `${translationModeLabel}单张处理已中断`,
          detail: err.message || '已手动中断',
          meta: {
            ...baseMeta,
            fileName: fileItem.file?.name || fileItem.relativePath,
            relativePath: fileItem.relativePath,
            taskId: fileItem.taskId,
          },
        });
      } else {
        void logActionFailure({
          module: 'translation',
          action: mode === 'recover' ? 'recover_single' : 'process_single',
          message: `${translationModeLabel}单张处理失败`,
          detail: err.message || '未知错误',
          meta: {
            ...baseMeta,
            fileName: fileItem.file?.name || fileItem.relativePath,
            relativePath: fileItem.relativePath,
            taskId: fileItem.taskId,
            matchedAspectRatio: fileItem.matchedAspectRatio,
          },
        });
      }
    } finally {
      delete controllersRef.current[fileId];
    }
  };

  const runScheduler = async () => {
    while (activeJobsRef.current < apiConfig.concurrency && pendingQueueRef.current.length > 0) {
      const taskFileId = pendingQueueRef.current.shift()!;
      activeJobsRef.current++;
      if (!isProcessing) onProcessingChange(true);

      executeFileTask(taskFileId).finally(() => {
        activeJobsRef.current = Math.max(0, activeJobsRef.current - 1);
        if (activeJobsRef.current === 0 && pendingQueueRef.current.length === 0) {
          submissionLockRef.current = false;
          onProcessingChange(false);
          setIsSubmitting(false);
        }
        runScheduler();
      });
    }
  };

  const startProcessing = () => {
    if (submissionLockRef.current || isProcessing || isSubmitting || files.length === 0) return;
    
    if (activeModule === AppModule.TRANSLATION && shouldValidateTranslationAspectRatio(config, subMode || TranslationSubMode.MAIN)) {
        const [w, h] = config.aspectRatio.split(':').map(Number);
        const ratio = w / h;
        const currentRatio = config.targetWidth / config.targetHeight;
        
        if (Math.abs(ratio - currentRatio) > 0.01) {
            setAlertMessage('当前导出尺寸不符合构图比例，请修正尺寸设置。');
            return;
        }
    }

    const targetIds = files
      .filter(f => f.status === 'pending' || f.status === 'error' || f.status === 'interrupted')
      .map(f => f.id);

    if (targetIds.length === 0) return;
    submissionLockRef.current = true;
    void logActionStart({
      module: 'translation',
      action: 'batch_start',
      message: `启动${translationModeLabel}批量任务`,
      meta: {
        ...baseMeta,
        count: targetIds.length,
      },
    });
    setIsSubmitting(true);
    pendingQueueRef.current = targetIds;
    runScheduler();
  };

  const interruptAllTasks = () => {
    const runningIds = Object.keys(controllersRef.current);
    runningIds.forEach((id) => {
      controllersRef.current[id]?.abort();
    });

    const queuedIds = [...pendingQueueRef.current];
    pendingQueueRef.current = [];

    onFilesChange(prev => {
      const currentList = Array.isArray(prev) ? prev : filesRef.current;
      return currentList.map(file => {
        if (runningIds.includes(file.id) || queuedIds.includes(file.id)) {
          return {
            ...file,
            status: 'interrupted',
            error: '已手动全部暂停',
            progress: 0,
          };
        }
        return file;
      });
    });
    void logActionInterrupted({
      module: 'translation',
      action: 'interrupt_all',
      message: `全部暂停${translationModeLabel}任务`,
      meta: {
        ...baseMeta,
        runningCount: runningIds.length,
        queuedCount: queuedIds.length,
      },
    });
    submissionLockRef.current = false;
    setIsSubmitting(false);
    onProcessingChange(false);
  };

  const interruptTask = (id: string) => {
    if (controllersRef.current[id]) {
      controllersRef.current[id].abort();
      updateSingleFile(id, { status: 'interrupted', error: '已手动中断', progress: 0 });
      const item = filesRef.current.find((file) => file.id === id);
      void logActionInterrupted({
        module: 'translation',
        action: 'interrupt_single',
        message: `${translationModeLabel}单张任务已中断`,
        meta: {
          ...baseMeta,
          fileName: item?.file?.name || item?.relativePath,
          relativePath: item?.relativePath,
          taskId: item?.taskId,
        },
      });
    }
  };

  const handleRetrySingle = (id: string) => {
    if (isSubmitting) return;
    const item = filesRef.current.find((file) => file.id === id);
    void logActionStart({
      module: 'translation',
      action: 'retry_single',
      message: `${translationModeLabel}重新生成单张文件`,
      meta: {
        ...baseMeta,
        fileName: item?.file?.name || item?.relativePath,
        relativePath: item?.relativePath,
        taskId: item?.taskId,
      },
    });
    updateSingleFile(id, { 
      status: 'pending', progress: 0, error: undefined, resultBlob: undefined, resultUrl: undefined 
    });
    submissionLockRef.current = true;
    setIsSubmitting(true);
    setTimeout(() => {
      if (!isProcessing) {
        pendingQueueRef.current = [id];
        runScheduler();
      } else {
        pendingQueueRef.current.push(id);
      }
    }, 50);
  };

  const handleRecoverSingle = (id: string) => {
    if (isProcessing) return;
    const item = filesRef.current.find((file) => file.id === id);
    void logActionStart({
      module: 'translation',
      action: 'recover_single_click',
      message: `${translationModeLabel}尝试找回结果`,
      meta: {
        ...baseMeta,
        fileName: item?.file?.name || item?.relativePath,
        relativePath: item?.relativePath,
        taskId: item?.taskId,
      },
    });
    onProcessingChange(true);
    executeFileTask(id, 'recover').finally(() => onProcessingChange(false));
  };

  const downloadSingle = (item: FileItem) => {
    void logActionSuccess({
      module: 'translation',
      action: 'download_single',
      message: `${translationModeLabel}导出单张结果`,
      meta: {
        ...baseMeta,
        fileName: item.file?.name || item.relativePath,
        relativePath: item.relativePath,
        taskId: item.taskId,
      },
    });
    const directBlob = item.resultBlob;
    const downloadName = item.relativePath.split('/').pop() || 'translation_result.png';

    if (directBlob) {
      const url = safeCreateObjectURL(directBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    if (item.resultUrl) {
      const link = document.createElement('a');
      link.href = item.resultUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const downloadAll = async () => {
    const completed = files.filter(f => f.status === 'completed' && (f.resultBlob instanceof Blob || f.resultUrl));
    if (completed.length === 0) return;
    void logActionStart({
      module: 'translation',
      action: 'download_batch',
      message: `${translationModeLabel}开始批量导出`,
      meta: {
        ...baseMeta,
        count: completed.length,
      },
    });
    try {
      const zipData = await Promise.all(completed.map(async (f) => {
        if (f.resultBlob instanceof Blob) {
          return { blob: f.resultBlob, path: normalizeZipPath(f.relativePath || 'translation_result.png') };
        }

        const response = await fetch(f.resultUrl!);
        const blob = await response.blob();
        return { blob, path: normalizeZipPath(f.relativePath || 'translation_result.png') };
      }));
      await createZipAndDownload(zipData, `translation_export_${Date.now()}`);
      void logActionSuccess({
        module: 'translation',
        action: 'download_batch',
        message: `${translationModeLabel}批量导出成功`,
        meta: {
          ...baseMeta,
          count: completed.length,
        },
      });
    } catch (err) {
      setAlertMessage("导出失败，请检查浏览器权限。");
      void logActionFailure({
        module: 'translation',
        action: 'download_batch',
        message: `${translationModeLabel}批量导出失败`,
        detail: err instanceof Error ? err.message : '导出失败',
        meta: {
          ...baseMeta,
          count: completed.length,
        },
      });
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_100%)]">
      {alertMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm shadow-2xl border border-rose-100 text-center animate-in zoom-in duration-200">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-exclamation-triangle text-rose-500 text-2xl"></i>
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">提示</h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">{alertMessage}</p>
            <button onClick={() => setAlertMessage(null)} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-lg">确定</button>
          </div>
        </div>
      )}

      <div className="z-10 mx-6 mt-5 shrink-0 rounded-[28px] border border-slate-200/80 bg-white/90 px-6 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-200"><i className="fas fa-file-image mr-2 text-slate-400"></i>导入图片</button>
            <button onClick={() => folderInputRef.current?.click()} disabled={isProcessing} className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-200"><i className="fas fa-folder-open mr-2 text-slate-400"></i>导入文件夹</button>
            <button onClick={clearFiles} disabled={isProcessing || files.length === 0} className="rounded-2xl border border-rose-100 bg-white px-4 py-2.5 text-sm font-semibold text-rose-500 transition-all hover:bg-rose-50">清空当前列表</button>
          </div>
          <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={handleFileSelect} className="hidden" />
          <input type="file" ref={folderInputRef} {...({ webkitdirectory: "" } as any)} onChange={handleFileSelect} className="hidden" />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={interruptAllTasks}
              disabled={!isProcessing && !isSubmitting && pendingQueueRef.current.length === 0}
              className="rounded-2xl bg-rose-600 px-5 py-2.5 text-xs font-semibold tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(225,29,72,0.18)] transition-all hover:bg-rose-700 disabled:opacity-50"
            >
              全部暂停
            </button>
            <button onClick={downloadAll} disabled={isProcessing || !files.some(f => f.status === 'completed')} className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(5,150,105,0.18)] transition-all hover:bg-emerald-700 disabled:opacity-50">打包导出</button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-5">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex-1 overflow-y-auto scrollbar-hide relative min-h-0">
            <table className="w-full text-left table-fixed border-collapse">
              <thead className="bg-slate-50/90 border-b border-slate-100 sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="w-40 px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-center">生成对照</th>
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">资源路径</th>
                  <th className="w-44 px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-center">状态</th>
                  <th className="w-48 px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {files.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/30 transition-colors group">
                    <td className="px-8 py-4">
                      <div className="flex items-center justify-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden ring-1 ring-slate-200 shrink-0">
                          {item.sourcePreviewUrl ? (
                            <img src={item.sourcePreviewUrl} className="w-full h-full object-cover" />
                          ) : item.file ? (
                            <img src={safeCreateObjectURL(item.file)} className="w-full h-full object-cover" />
                          ) : null}
                        </div>
                        <div className="w-2 h-0.5 bg-slate-200"></div>
                        <div 
                          className={`w-12 h-12 rounded-xl overflow-hidden ring-1 shrink-0 ${item.status === 'completed' ? 'bg-white ring-indigo-200 cursor-pointer hover:ring-indigo-500' : 'bg-slate-50 ring-slate-100'}`}
                          onClick={() => item.status === 'completed' && setSelectedItem(item)}
                        >
                          {item.resultUrl ? (
                            <img src={item.resultUrl} className="w-full h-full object-cover shadow-sm" />
                          ) : item.resultBlob ? (
                            <img src={safeCreateObjectURL(item.resultBlob)} className="w-full h-full object-cover shadow-sm" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <i className={`fas ${['processing', 'uploading'].includes(item.status) ? 'fa-spinner fa-spin text-indigo-400' : 'fa-image text-slate-200'}`}></i>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-4">
                      <div className="text-xs font-bold text-slate-700 truncate" title={item.relativePath}>
                        <i className="fas fa-file-alt text-slate-400 mr-2"></i>{item.relativePath}
                      </div>
                      {isDetailMode && item.matchedAspectRatio ? (
                        <div className="text-[10px] text-indigo-500 font-black mt-1">
                          匹配比例：{item.matchedAspectRatio}
                        </div>
                      ) : null}
                      {item.error && <div className="text-[10px] text-rose-500 font-bold mt-1 leading-tight">{item.error}</div>}
                      {item.status === 'processing' && item.progress < 100 && (
                        <div className="w-full h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                          <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${item.progress}%` }}></div>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-4 text-center">
                       <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter shadow-sm border ${
                         item.status === 'completed' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 
                         item.status === 'error' ? 'text-rose-600 bg-rose-50 border-rose-100' :
                         item.status === 'interrupted' ? 'text-amber-600 bg-amber-50 border-amber-100' :
                         item.status === 'pending' ? 'text-slate-400 bg-slate-100 border-slate-200' : 'text-indigo-600 bg-indigo-50 border-indigo-100'
                       }`}>
                         {item.status === 'uploading' ? '正在上传' : item.status === 'processing' ? '正在生成' : item.status === 'interrupted' ? '已中断' : item.status}
                       </span>
                    </td>
                    <td className="px-8 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {item.status === 'completed' && (
                          <>
                            <button onClick={() => downloadSingle(item)} className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-black rounded-lg hover:bg-emerald-700 transition-all shadow-sm">导出</button>
                            <button onClick={() => handleRetrySingle(item.id)} disabled={isProcessing || isSubmitting} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="重新生成"><i className="fas fa-redo text-xs"></i></button>
                          </>
                        )}
                        {(item.status === 'error' || item.status === 'interrupted') && (
                          <>
                            {item.taskId && (
                              <button onClick={() => handleRecoverSingle(item.id)} disabled={isProcessing} className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-black rounded-lg hover:bg-indigo-700 transition-all shadow-sm" title="通过 ID 获取图片结果">获取结果</button>
                            )}
                            <button onClick={() => handleRetrySingle(item.id)} disabled={isProcessing || isSubmitting} className="px-3 py-1.5 bg-rose-600 text-white text-[10px] font-black rounded-lg hover:bg-rose-700 transition-all shadow-sm">重新生成</button>
                          </>
                        )}
                        {['processing', 'uploading'].includes(item.status) && (
                          <button onClick={() => interruptTask(item.id)} className="px-4 py-1.5 bg-slate-100 text-slate-600 text-[10px] font-black rounded-lg hover:bg-slate-200 transition-all border border-slate-200">中断</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {files.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center p-24 text-center bg-slate-50/20 h-full">
                 <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-6 border border-slate-100 text-slate-200"><i className="fas fa-cloud-upload-alt text-3xl"></i></div>
                 <h4 className="text-slate-400 font-semibold text-sm">导入图片开始处理</h4>
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedItem && <ComparisonModal item={selectedItem} config={config} onClose={() => setSelectedItem(null)} />}
    </div>
  );
};

export default FileProcessor;
