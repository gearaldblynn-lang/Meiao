
import React, { useState, useRef, useEffect } from 'react';
import { GlobalApiConfig, RetouchTask, RetouchPersistentState, AspectRatio, KieAiResult } from '../../types';
import RetouchSidebar from './RetouchSidebar';
import { analyzeRetouchTask } from '../../services/arkService';
import { uploadToCos } from '../../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { createZipAndDownload, resizeImage, getImageDimensions } from '../../utils/imageUtils';
import { normalizeFetchedImageBlob } from '../../utils/imageBlobUtils.mjs';
import { releaseObjectURLs, safeCreateObjectURL } from '../../utils/urlUtils';
import { logActionFailure, logActionInterrupted, logActionStart, logActionSuccess } from '../../services/loggingService';
import { getTaskDisplayName } from '../../utils/cloudAssetState.mjs';
import { persistGeneratedAsset } from '../../services/persistedAssetClient';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: RetouchPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<RetouchPersistentState>>;
}

const RetouchModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const { tasks, pendingFiles, referenceImage, mode, aspectRatio, quality, model, resolutionMode, targetWidth, targetHeight } = persistentState;
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<RetouchTask | null>(null);
  const baseMeta = { mode, model, quality, aspectRatio };
  
  const controllersRef = useRef<Record<string, AbortController>>({});
  const activeWorkersRef = useRef(0);
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const startBatchLockRef = useRef(false);
  
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const getRetouchTaskName = (task: RetouchTask) => getTaskDisplayName(task, 'retouch.png');

  const updateTaskStatus = (taskId: string, updates: Partial<RetouchTask>) => {
    onStateChange(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
    }));
  };

  const handleAddFiles = (files: File[]) => {
    void logActionSuccess({
      module: 'retouch',
      action: 'add_files',
      message: '添加产品精修文件',
      meta: {
        ...baseMeta,
        count: files.length,
      },
    });
    onStateChange(prev => ({ ...prev, pendingFiles: [...prev.pendingFiles, ...files] }));
  };

  const processTask = async (task: RetouchTask) => {
    const controller = new AbortController();
    controllersRef.current[task.id] = controller;

    try {
      void logActionStart({
        module: 'retouch',
        action: task.taskId ? 'recover_single' : 'generate_single',
        message: task.taskId ? '开始找回精修结果' : '开始生成精修结果',
        meta: {
          ...baseMeta,
          taskId: task.id,
          fileName: getRetouchTaskName(task),
          relativePath: task.relativePath,
          kieTaskId: task.taskId,
        },
      });
      updateTaskStatus(task.id, { status: 'uploading', progress: 5, error: undefined });

      let res: KieAiResult;

      if (task.taskId) {
        updateTaskStatus(task.id, { error: '正在检查历史生成进度...' });
        res = await recoverKieAiTask(task.taskId, apiConfig, controller.signal);
        
        if (res.status !== 'success') {
          updateTaskStatus(task.id, { error: undefined });
          res = await triggerNewRetouchTask(task, controller.signal);
        }
      } else {
        res = await triggerNewRetouchTask(task, controller.signal);
      }

      if (res.status === 'success') {
        let finalUrl = res.imageUrl;

        if (resolutionMode === 'custom' && (targetWidth > 0 || targetHeight > 0)) {
          try {
            updateTaskStatus(task.id, { error: '正在重采样尺寸...' });
            const response = await fetch(res.imageUrl, { signal: controller.signal });
            const blob = await normalizeFetchedImageBlob(await response.blob(), res.imageUrl);
            
            let w = targetWidth;
            let h = targetHeight;

            if (w > 0 && h === 0) {
              const dims = await getImageDimensions(blob);
              h = Math.round(w / dims.ratio);
            } else if (h > 0 && w === 0) {
              const dims = await getImageDimensions(blob);
              w = Math.round(h * dims.ratio);
            }

            if (w > 0 && h > 0) {
              const resizedBlob = await resizeImage(blob, w, h);
              finalUrl = await persistGeneratedAsset(resizedBlob, 'retouch', getRetouchTaskName(task));
            }
          } catch (e) {
            console.warn("Resizing failed, using original AI output", e);
          }
        }

        if (!finalUrl || finalUrl.startsWith('blob:')) {
          const response = await fetch(finalUrl || res.imageUrl, { signal: controller.signal });
          const persistedBlob = await normalizeFetchedImageBlob(await response.blob(), finalUrl || res.imageUrl);
          finalUrl = await persistGeneratedAsset(persistedBlob, 'retouch', getRetouchTaskName(task));
        }

        updateTaskStatus(task.id, { status: 'completed', resultUrl: finalUrl, taskId: res.taskId, progress: 100, error: undefined });
        void logActionSuccess({
          module: 'retouch',
          action: task.taskId ? 'recover_single' : 'generate_single',
          message: task.taskId ? '找回精修结果成功' : '精修结果生成成功',
          meta: {
            ...baseMeta,
            taskId: task.id,
            fileName: getRetouchTaskName(task),
            relativePath: task.relativePath,
            kieTaskId: res.taskId,
          },
        });
      } else if (res.status === 'interrupted') {
        throw new Error("INTERRUPTED");
      } else {
        throw new Error(res.message || '渲染引擎返回异常');
      }

    } catch (err: any) {
      const isInterrupt = err.message === 'INTERRUPTED' || err.name === 'AbortError';
      updateTaskStatus(task.id, { 
        status: isInterrupt ? 'interrupted' : 'error', 
        error: isInterrupt ? undefined : err.message, 
        progress: 0 
      });
      if (isInterrupt) {
        void logActionInterrupted({
          module: 'retouch',
          action: task.taskId ? 'recover_single' : 'generate_single',
          message: task.taskId ? '找回精修结果已中断' : '精修结果生成已中断',
          detail: err.message,
          meta: {
            ...baseMeta,
            taskId: task.id,
            fileName: getRetouchTaskName(task),
            relativePath: task.relativePath,
            kieTaskId: task.taskId,
          },
        });
      } else {
        void logActionFailure({
          module: 'retouch',
          action: task.taskId ? 'recover_single' : 'generate_single',
          message: task.taskId ? '找回精修结果失败' : '精修结果生成失败',
          detail: err.message,
          meta: {
            ...baseMeta,
            taskId: task.id,
            fileName: getRetouchTaskName(task),
            relativePath: task.relativePath,
            kieTaskId: task.taskId,
          },
        });
      }
    } finally {
      delete controllersRef.current[task.id];
      inflightIdsRef.current.delete(task.id);
    }
  };

  const triggerNewRetouchTask = async (task: RetouchTask, signal: AbortSignal) => {
    updateTaskStatus(task.id, { error: '正在上传素材至云端...' });
    const sourceUrl = task.sourceUrl || (task.file ? await uploadToCos(task.file, apiConfig) : '');
    if (!sourceUrl) {
      throw new Error('原始文件已失效，请重新导入后再生成。');
    }
    updateTaskStatus(task.id, { sourceUrl });
    let refUrl = persistentState.uploadedReferenceUrl || null;
    if (referenceImage && !refUrl) {
      refUrl = await uploadToCos(referenceImage, apiConfig);
    }
    if (signal.aborted) throw new Error("INTERRUPTED");

    updateTaskStatus(task.id, { error: 'AI 正在执行视觉精修分析...' });
    const analysis = await analyzeRetouchTask(sourceUrl, mode, apiConfig, refUrl, signal);
    if (analysis.status === 'error') throw new Error(analysis.message);
    
    updateTaskStatus(task.id, { retouchPrompt: analysis.description, progress: 45, status: 'processing', error: undefined });

    // 1. 构建角色标注逻辑
    let finalPrompt = "";
    if (refUrl) {
      finalPrompt += `${sourceUrl} 为待精修图，${refUrl} 为精修参考效果图。\n\n`;
    }

    // 2. 注入核心精修指令
    finalPrompt += `【核心精修指令】：\n${analysis.description}\n\n`;

    // 3. 严格执行标准优化 - 去掉括号描述
    let strictStandards = `【严格执行标准】：\n`;
    strictStandards += `1. 主体保真与防锐化：严禁改变品牌 Logo、标签文字内容。严禁对产品/包装上的文字和标识进行过度锐化，必须保证包装上的所有文字清晰无误、不产生畸变、重影 or 笔画断裂。\n`;
    strictStandards += `2. 风格精准重塑：必须严格执行上述指令中定义的渲染风格，禁止模糊化执行，确保光影氛围与材质表达高度商业化。\n`;
    if (mode === 'original') {
      strictStandards += `3. 原图连续性：原图精修必须严格基于待精修图当前画面做优化，只允许做质感、光影、透视、瑕疵、色彩和局部细节修正。\n`;
      strictStandards += `4. 禁止重绘：禁止把原图精修做成重新换背景、换场景、换产品摆法、换镜头角度的大幅重绘。\n`;
      strictStandards += `5. 内容克制：若无明确指令，不得新增原图中不存在的产品、道具、装饰元素或额外视觉主体。\n`;
    }

    if (mode === 'white_bg') {
      strictStandards += `3. 构图占比优化：若原图中产品主体占比过小，必须将产品主体放大至占满画面约 80%-90% 的空间，以提高商品画面占比，增强视觉重心。\n`;
    }
    
    strictStandards += `${mode === 'original' ? '6' : '4'}. 比例自适应：适配 ${aspectRatio} 比例构图。`;

    finalPrompt += strictStandards;

    return await processWithKieAi(
      refUrl ? [sourceUrl, refUrl] : sourceUrl,
      apiConfig,
      {
        targetLanguage: 'zh',
        customLanguage: '',
        removeWatermark: true,
        aspectRatio: aspectRatio, 
        quality: quality,
        model: model,
        resolutionMode: 'original',
        targetWidth: 0,
        targetHeight: 0,
        maxFileSize: 2.0
      },
      aspectRatio === AspectRatio.AUTO,
      signal,
      finalPrompt
    );
  };

  const startBatch = async () => {
    const hasQueuedTasks = tasksRef.current.some((task) => task.status === 'pending' && !inflightIdsRef.current.has(task.id));
    if (startBatchLockRef.current || (pendingFiles.length === 0 && !hasQueuedTasks)) return;
    startBatchLockRef.current = true;
    void logActionStart({
      module: 'retouch',
      action: 'batch_start',
      message: '启动批量产品精修',
      meta: {
        ...baseMeta,
        count: pendingFiles.length || tasksRef.current.filter((task) => task.status === 'pending').length,
      },
    });

    const newTasksFromPending: RetouchTask[] = pendingFiles.map(f => ({
      id: Math.random().toString(36).substr(2, 9),
      file: f,
      fileName: f.name,
      relativePath: f.name,
      status: 'pending',
      progress: 0,
      mode: mode
    }));

    if (newTasksFromPending.length > 0) {
      onStateChange(prev => ({
        ...prev,
        tasks: [...prev.tasks, ...newTasksFromPending],
        pendingFiles: []
      }));
    }

    setTimeout(() => runWorkerCycle(), 50);
    setTimeout(() => {
      startBatchLockRef.current = false;
    }, 0);
  };

  const runWorkerCycle = async () => {
    if (activeWorkersRef.current >= apiConfig.concurrency) return;
    
    setIsProcessing(true);
    
    const worker = async () => {
      activeWorkersRef.current++;
      
      while (true) {
        const nextTask = tasksRef.current.find(t => 
            t.status === 'pending' && !inflightIdsRef.current.has(t.id)
        );

        if (!nextTask) break;

        inflightIdsRef.current.add(nextTask.id);
        
        await processTask(nextTask);
      }
      
      activeWorkersRef.current--;
      if (activeWorkersRef.current === 0) {
        setIsProcessing(false);
      }
    };

    const neededWorkers = Math.min(
        apiConfig.concurrency - activeWorkersRef.current, 
        tasksRef.current.filter(t => t.status === 'pending' && !inflightIdsRef.current.has(t.id)).length
    );

    for (let i = 0; i < neededWorkers; i++) {
      worker();
    }
  };

  const handleDownloadSingle = async (task: RetouchTask) => {
    if (!task.resultUrl) return;
    void logActionSuccess({
      module: 'retouch',
      action: 'download_single',
      message: '下载单张精修结果',
      meta: {
        ...baseMeta,
        taskId: task.id,
        fileName: getRetouchTaskName(task),
      },
    });
    try {
      // 强制流式下载逻辑
      const response = await fetch(task.resultUrl, { mode: 'cors', cache: 'no-cache' });
      if (!response.ok) throw new Error("Fetch failed");
      const blob = await response.blob();
      const blobUrl = safeCreateObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      const baseFileName = getRetouchTaskName(task);
      const fileName = baseFileName.includes('.') ? baseFileName : `${baseFileName}.png`;
      link.download = `retouched_${fileName}`;
      
      // 必须 append 到 body 触发
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // 延迟释放，确保浏览器已接管下载流
      setTimeout(() => {
        if (blobUrl) window.URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch (e) {
      console.error("Advanced download failed, using standard anchor download", e);
      // 备选方案：仍尝试使用 download 属性，但不设置 target="_blank" 以防新开页面
      const link = document.createElement('a');
      link.href = task.resultUrl;
      link.download = `retouched_${getRetouchTaskName(task)}`;
      link.click();
    }
  };

  const handleBatchDownload = async () => {
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.resultUrl);
    if (completedTasks.length === 0) return;

    setIsBatchDownloading(true);
    void logActionStart({
      module: 'retouch',
      action: 'download_batch',
      message: '开始批量下载精修结果',
      meta: {
        ...baseMeta,
        count: completedTasks.length,
      },
    });
    try {
      const zipFiles = await Promise.all(
        completedTasks.map(async (task) => {
          const resp = await fetch(task.resultUrl!);
          const blob = await resp.blob();
          return { blob, path: `retouched_${getRetouchTaskName(task)}` };
        })
      );
      await createZipAndDownload(zipFiles, `mayo_retouch_batch_${Date.now()}`);
      void logActionSuccess({
        module: 'retouch',
        action: 'download_batch',
        message: '批量下载精修结果成功',
        meta: {
          ...baseMeta,
          count: completedTasks.length,
        },
      });
    } catch (err) {
      void logActionFailure({
        module: 'retouch',
        action: 'download_batch',
        message: '批量下载精修结果失败',
        detail: err instanceof Error ? err.message : '下载失败',
        meta: {
          ...baseMeta,
          count: completedTasks.length,
        },
      });
      console.error("Batch download error:", err);
      alert("打包下载失败，请重试");
    } finally {
      setIsBatchDownloading(false);
    }
  };

  const handleExportToBgSub = async (task: RetouchTask) => {
    if (!task.resultUrl) return;
    void logActionSuccess({
      module: 'retouch',
      action: 'copy_result_link',
      message: '复制精修结果链接',
      meta: {
        ...baseMeta,
        taskId: task.id,
        fileName: getRetouchTaskName(task),
      },
    });
    try {
      await navigator.clipboard.writeText(task.resultUrl);
      alert("精修图片链接已复制！跳转后 Ctrl+V 即可。");
      window.open("https://zh.bgsub.com/webapp/", "_blank");
    } catch (err) {
      window.open("https://zh.bgsub.com/webapp/", "_blank");
    }
  };

  return (
    <div className="h-full w-full flex overflow-hidden">
      <RetouchSidebar 
        onAddFiles={handleAddFiles}
        pendingFiles={pendingFiles}
        tasks={tasks}
        onClearPending={() => {
          releaseObjectURLs([
            ...pendingFiles,
            referenceImage,
          ]);
          void logActionSuccess({
            module: 'retouch',
            action: 'clear_pending',
            message: '清空待处理精修队列',
            meta: {
              ...baseMeta,
              count: pendingFiles.length,
            },
          });
          onStateChange(prev => ({ ...prev, pendingFiles: [] }));
        }}
        referenceImage={referenceImage}
        uploadedReferenceUrl={persistentState.uploadedReferenceUrl}
        setReferenceImage={(img) => onStateChange(prev => ({ ...prev, referenceImage: img }))}
        onUploadedReferenceUrlChange={(url) => onStateChange(prev => ({ ...prev, uploadedReferenceUrl: url }))}
        apiConfig={apiConfig}
        mode={mode}
        setMode={(m) => onStateChange(prev => ({ ...prev, mode: m }))}
        aspectRatio={aspectRatio}
        setAspectRatio={(r) => onStateChange(prev => ({ ...prev, aspectRatio: r }))}
        quality={quality}
        setQuality={(q) => onStateChange(prev => ({ ...prev, quality: q }))}
        model={model}
        setModel={(m) => onStateChange(prev => ({ ...prev, model: m }))}
        resolutionMode={resolutionMode}
        setResolutionMode={(m) => onStateChange(prev => ({ ...prev, resolutionMode: m }))}
        targetWidth={targetWidth}
        setTargetWidth={(w) => onStateChange(prev => ({ ...prev, targetWidth: w }))}
        targetHeight={targetHeight}
        setTargetHeight={(h) => onStateChange(prev => ({ ...prev, targetHeight: h }))}
        onStart={startBatch}
        isProcessing={isProcessing}
        hasTasks={tasks.length > 0}
      />

      <main className="flex-1 overflow-y-auto p-8 bg-slate-50 scrollbar-hide relative">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between bg-white px-6 py-4 rounded-[32px] border border-slate-100 shadow-xl sticky top-0 z-20 backdrop-blur-md bg-white/90">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                精修结果
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => {
                void logActionSuccess({
                  module: 'retouch',
                  action: 'clear_records',
                  message: '清空精修记录',
                  meta: {
                    ...baseMeta,
                    count: tasks.length,
                  },
                });
                onStateChange(prev => ({ ...prev, tasks: [] }));
              }} className="px-5 py-2.5 bg-slate-100 text-slate-500 font-semibold text-xs rounded-xl hover:bg-slate-200 transition-all border border-slate-200">清空记录</button>
              <button onClick={handleBatchDownload} disabled={isBatchDownloading || !tasks.some(t => t.status === 'completed')} className="px-5 py-2.5 bg-emerald-600 text-white font-semibold text-xs rounded-xl hover:bg-emerald-700 shadow-xl disabled:bg-slate-200 transition-all tracking-[0.16em]">
                {isBatchDownloading ? '正在打包...' : '批量下载结果'}
              </button>
              <button onClick={startBatch} disabled={pendingFiles.length === 0 || isProcessing} className="px-5 py-2.5 bg-slate-900 text-white font-semibold text-xs rounded-xl hover:bg-slate-800 shadow-xl disabled:bg-slate-100 transition-all tracking-[0.16em]">
                {isProcessing ? '正在提交队列...' : '启动渲染任务'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
            {tasks.map((task) => (
              <div key={task.id} className="bg-white rounded-[32px] border border-slate-100 shadow-xl overflow-hidden flex flex-col group transition-all duration-500 hover:ring-2 hover:ring-emerald-500">
                <div className="p-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                  <span className="text-[10px] font-black text-slate-400 truncate max-w-[140px] uppercase tracking-wider">{getRetouchTaskName(task)}</span>
                  <div className="flex gap-2">
                    {task.status === 'completed' && (
                       <button onClick={() => handleExportToBgSub(task)} className="w-7 h-7 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all" title="一键抠图"><i className="fas fa-scissors text-[10px]"></i></button>
                    )}
                    <button onClick={() => onStateChange(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== task.id) }))} className="w-7 h-7 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center hover:bg-rose-50 hover:text-rose-500 transition-all"><i className="fas fa-trash text-[10px]"></i></button>
                  </div>
                </div>

                <div className="relative aspect-square bg-slate-100 overflow-hidden cursor-pointer" onClick={() => task.status === 'completed' && setSelectedTask(task)}>
                  {task.status === 'completed' && task.resultUrl ? (
                    <div className="relative w-full h-full group">
                      <img src={task.resultUrl || undefined} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i className="fas fa-search-plus text-white text-3xl"></i></div>
                    </div>
                  ) : (
                    <>
                      {(task.sourceUrl || (task.file ? safeCreateObjectURL(task.file) : '')) && <img src={task.sourceUrl || safeCreateObjectURL(task.file!)} className="w-full h-full object-cover opacity-60 grayscale" />}
                      {(task.status === 'processing' || task.status === 'uploading') && (
                        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6">
                           <div className="w-16 h-16 relative mb-4">
                              <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
                              <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                              <div className="absolute inset-0 flex items-center justify-center text-xs font-black">{task.progress}%</div>
                           </div>
                           <p className="text-[10px] font-black uppercase tracking-[0.2em] animate-pulse">精修渲染中...</p>
                           {task.error && <p className="text-[9px] font-bold text-emerald-300 mt-2 text-center">{task.error}</p>}
                        </div>
                      )}
                      {task.status === 'error' && (
                        <div className="absolute inset-0 bg-rose-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 text-center">
                           <i className="fas fa-exclamation-circle text-2xl mb-2"></i>
                           <p className="text-[10px] font-bold uppercase leading-relaxed">{task.error || '渲染失败'}</p>
                           <button onClick={() => {
                                inflightIdsRef.current.delete(task.id);
                                updateTaskStatus(task.id, { status: 'pending', error: undefined });
                                setTimeout(() => runWorkerCycle(), 0);
                           }} className="mt-4 px-4 py-1.5 bg-white text-rose-600 text-[10px] font-black rounded-lg">重试</button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {task.status === 'completed' && (
                  <div className="p-4 bg-white border-t border-slate-50 flex items-center justify-between">
                     <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div><span className="text-[9px] font-black text-emerald-600 uppercase">渲染成功</span></div>
                     <button onClick={() => handleDownloadSingle(task)} className="px-4 py-1.5 bg-slate-900 text-white text-[10px] font-black rounded-xl hover:bg-slate-800 transition-all flex items-center gap-2"><i className="fas fa-download"></i> 下载</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>

      {selectedTask && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8 animate-in fade-in duration-300" onClick={() => setSelectedTask(null)}>
          <div className="bg-white w-full max-w-7xl h-[85vh] rounded-[40px] overflow-hidden flex flex-col shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSelectedTask(null)} className="absolute top-6 right-6 w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center hover:bg-rose-50 hover:text-rose-500 transition-all z-10"><i className="fas fa-times text-xl"></i></button>
            <div className="p-8 border-b border-slate-50 flex items-center gap-4 bg-white shrink-0">
               <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600"><i className="fas fa-columns text-lg"></i></div>
               <div><h3 className="text-lg font-black text-slate-800">精修细节对比</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Master Retouch Comparison</p></div>
            </div>
            <div className="flex-1 flex overflow-hidden divide-x divide-slate-100 bg-slate-50">
               <div className="flex-1 flex flex-col p-6 relative">
                  <span className="absolute top-10 left-10 z-10 px-4 py-1.5 bg-slate-800/80 backdrop-blur text-white text-[10px] font-black rounded-full uppercase tracking-widest">Original / 原图</span>
                  <div className="flex-1 flex items-center justify-center overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-inner">
                    {(selectedTask.sourceUrl || (selectedTask.file ? safeCreateObjectURL(selectedTask.file) : '')) && <img src={selectedTask.sourceUrl || safeCreateObjectURL(selectedTask.file!)} className="max-w-full max-h-full object-contain" />}
                  </div>
               </div>
               <div className="flex-1 flex flex-col p-6 relative">
                  <span className="absolute top-10 left-10 z-10 px-4 py-1.5 bg-emerald-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Enhanced / 精修结果</span>
                  <div className="flex-1 flex items-center justify-center overflow-hidden rounded-3xl bg-white border border-emerald-100 shadow-inner">
                    {selectedTask.resultUrl && <img src={selectedTask.resultUrl} className="max-w-full max-h-full object-contain" />}
                  </div>
               </div>
            </div>
            <div className="p-6 border-t border-slate-50 flex items-center justify-between px-10">
               <div className="flex items-center gap-6">
                  <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">构图比例</span><span className="text-xs font-bold text-slate-700">{aspectRatio}</span></div>
                  <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">渲染品质</span><span className="text-xs font-bold text-slate-700 uppercase">{quality}</span></div>
               </div>
               <div className="flex gap-4">
                  <button onClick={() => handleExportToBgSub(selectedTask)} className="px-8 py-2.5 bg-indigo-50 text-indigo-600 font-black text-xs rounded-xl hover:bg-indigo-100 transition-all uppercase tracking-widest">导出至一键抠图</button>
                  <button onClick={() => handleDownloadSingle(selectedTask)} className="px-10 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-slate-800 transition-all uppercase tracking-widest">下载精修图</button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetouchModule;
