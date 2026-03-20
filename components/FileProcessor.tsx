
import React, { useRef, useState, useEffect } from 'react';
import { FileItem, ModuleConfig, GlobalApiConfig, AspectRatio, AppModule, TranslationSubMode, KieAiResult } from '../types';
import { safeCreateObjectURL } from '../utils/urlUtils';
import { uploadToCos } from '../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../services/kieAiService';
import { resizeImage, createZipAndDownload, getImageDimensions } from '../utils/imageUtils';
import ComparisonModal from './ComparisonModal';

interface Props {
  activeModule: AppModule;
  subMode?: TranslationSubMode;
  apiConfig: GlobalApiConfig;
  config: ModuleConfig;
  files: FileItem[];
  onFilesChange: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
  isProcessing: boolean;
  onProcessingChange: (processing: boolean) => void;
}

const FileProcessor: React.FC<Props> = ({ 
  activeModule, subMode, apiConfig, config, 
  files, onFilesChange, isProcessing, onProcessingChange 
}) => {
  const [selectedItem, setSelectedItem] = useState<FileItem | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const controllersRef = useRef<Record<string, AbortController>>({});
  const activeJobsRef = useRef(0);
  const pendingQueueRef = useRef<string[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isDetailMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.DETAIL;
  const isRemoveTextMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.REMOVE_TEXT;

  const filesRef = useRef(files);
  filesRef.current = files;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selectedFiles = Array.from(e.target.files) as File[];
    
    const validItems: FileItem[] = [];
    let hasViolation = false;

    for (const f of selectedFiles) {
      if (!f.type.startsWith('image/')) continue;
      
      if (isDetailMode) {
        const dims = await getImageDimensions(f);
        if (dims.height > dims.width * 4) {
          hasViolation = true;
          continue; 
        }
      }

      const relativePath = (f as any).webkitRelativePath || f.name;

      validItems.push({
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        relativePath: relativePath,
        status: 'pending',
        progress: 0
      });
    }

    if (hasViolation) {
      setAlertMessage('部分详情图比例超过 1:4，建议切片后上传以保证生成质量。');
    }

    onFilesChange(prev => Array.isArray(prev) ? [...prev, ...validItems] : [...files, ...validItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const clearFiles = () => {
    if (isProcessing) return;
    onFilesChange([]);
    controllersRef.current = {};
  };

  const updateSingleFile = (id: string, updates: Partial<FileItem>) => {
    onFilesChange(prev => {
      const currentList = Array.isArray(prev) ? prev : filesRef.current;
      return currentList.map(f => f.id === id ? { ...f, ...updates } : f);
    });
  };

  const executeFileTask = async (fileId: string, mode: 'full' | 'recover' = 'full') => {
    const fileItem = filesRef.current.find(f => f.id === fileId);
    if (!fileItem) return;

    if (controllersRef.current[fileId]) {
      controllersRef.current[fileId].abort();
    }
    const controller = new AbortController();
    controllersRef.current[fileId] = controller;

    try {
      updateSingleFile(fileId, { 
        status: mode === 'recover' ? 'processing' : 'uploading', 
        progress: 10, 
        error: undefined 
      });

      let res: KieAiResult;
      const dimensions = await getImageDimensions(fileItem.file);
      const effectiveConfig = isDetailMode ? { ...config, aspectRatio: AspectRatio.AUTO } : config;
      const isRatioMatch = effectiveConfig.aspectRatio === AspectRatio.AUTO;

      if (mode === 'recover' && fileItem.taskId) {
        updateSingleFile(fileId, { progress: 20, error: '正在尝试获取图片结果...' });
        res = await recoverKieAiTask(fileItem.taskId, apiConfig, controller.signal);
      } else {
        const cosUrl = await uploadToCos(fileItem.file, apiConfig);
        if (controller.signal.aborted) throw new Error("INTERRUPTED");
        
        updateSingleFile(fileId, { status: 'processing', progress: 30 });
        res = await processWithKieAi(cosUrl, apiConfig, effectiveConfig, isRatioMatch, controller.signal, undefined, isRemoveTextMode);
      }

      if (controller.signal.aborted || res.status === 'interrupted') throw new Error("INTERRUPTED");

      if (res.status === 'success') {
        updateSingleFile(fileId, { progress: 85, taskId: res.taskId });
        
        const response = await fetch(res.imageUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("获取生成图片失败");
        const blob = await response.blob();

        let targetW = dimensions.width;
        let targetH = dimensions.height;

        if (config.resolutionMode === 'custom') {
          targetW = config.targetWidth;
          if (isDetailMode || isRemoveTextMode) {
            targetH = Math.round(config.targetWidth / dimensions.ratio);
          } else {
            targetH = config.targetHeight;
          }
        }

        const finalBlob = await resizeImage(blob, targetW, targetH, config.maxFileSize);
        updateSingleFile(fileId, { status: 'completed', progress: 100, resultBlob: finalBlob, taskId: res.taskId });
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
        activeJobsRef.current--;
        if (activeJobsRef.current === 0 && pendingQueueRef.current.length === 0) {
          onProcessingChange(false);
          setIsSubmitting(false);
        }
        runScheduler();
      });
    }
  };

  const startProcessing = () => {
    if (isProcessing || isSubmitting || files.length === 0) return;
    
    if (activeModule === AppModule.TRANSLATION && config.resolutionMode === 'custom' && config.aspectRatio !== AspectRatio.AUTO) {
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
    setIsSubmitting(true);
    pendingQueueRef.current = targetIds;
    runScheduler();
  };

  const interruptTask = (id: string) => {
    if (controllersRef.current[id]) {
      controllersRef.current[id].abort();
      updateSingleFile(id, { status: 'interrupted', error: '已手动中断', progress: 0 });
    }
  };

  const handleRetrySingle = (id: string) => {
    if (isSubmitting) return;
    updateSingleFile(id, { 
      status: 'pending', progress: 0, error: undefined, resultBlob: undefined 
    });
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
    onProcessingChange(true);
    executeFileTask(id, 'recover').finally(() => onProcessingChange(false));
  };

  const downloadSingle = (item: FileItem) => {
    if (!item.resultBlob) return;
    const url = safeCreateObjectURL(item.resultBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    const completed = files.filter(f => f.status === 'completed' && f.resultBlob instanceof Blob);
    if (completed.length === 0) return;
    const zipData = completed.map(f => ({ 
      blob: f.resultBlob!, 
      path: f.file.name 
    }));
    try {
      await createZipAndDownload(zipData, `translation_export_${Date.now()}`);
    } catch (err) {
      setAlertMessage("导出失败，请检查浏览器权限。");
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative overflow-hidden">
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

      <div className="bg-white px-8 py-4 border-b border-slate-200 flex items-center justify-between shadow-sm z-10 shrink-0">
        <div className="flex gap-3">
          <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-sm rounded-xl hover:bg-slate-200 transition-all border border-slate-200"><i className="fas fa-file-image mr-2 text-slate-400"></i>导入图片</button>
          <button onClick={() => folderInputRef.current?.click()} disabled={isProcessing} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-sm rounded-xl hover:bg-slate-200 transition-all border border-slate-200"><i className="fas fa-folder-open mr-2 text-slate-400"></i>导入文件夹</button>
          <button onClick={clearFiles} disabled={isProcessing || files.length === 0} className="px-4 py-2 bg-white text-rose-500 font-bold text-sm rounded-xl hover:bg-rose-50 transition-all border border-rose-100">清空</button>
          <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={handleFileSelect} className="hidden" />
          <input type="file" ref={folderInputRef} {...({ webkitdirectory: "" } as any)} onChange={handleFileSelect} className="hidden" />
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={startProcessing} 
            disabled={isProcessing || isSubmitting || files.length === 0 || !files.some(f => f.status === 'pending' || f.status === 'error' || f.status === 'interrupted')} 
            className="px-6 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 disabled:bg-slate-300 transition-all uppercase tracking-widest min-w-[140px]"
          >
            {isProcessing || isSubmitting ? (
              <span className="flex items-center gap-2"><i className="fas fa-spinner fa-spin"></i> 处理中...</span>
            ) : '启动出海翻译'}
          </button>
          <button onClick={downloadAll} disabled={isProcessing || !files.some(f => f.status === 'completed')} className="px-6 py-2.5 bg-emerald-600 text-white font-black text-xs rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-100 disabled:opacity-50 transition-all uppercase tracking-widest">打包导出</button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-8 pt-6 min-h-0">
        <div className="flex-1 bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-0">
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
                          {item.file && <img src={safeCreateObjectURL(item.file)} className="w-full h-full object-cover" />}
                        </div>
                        <div className="w-2 h-0.5 bg-slate-200"></div>
                        <div 
                          className={`w-12 h-12 rounded-xl overflow-hidden ring-1 shrink-0 ${item.status === 'completed' ? 'bg-white ring-indigo-200 cursor-pointer hover:ring-indigo-500' : 'bg-slate-50 ring-slate-100'}`}
                          onClick={() => item.status === 'completed' && setSelectedItem(item)}
                        >
                          {item.resultBlob ? (
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
                 <h4 className="text-slate-400 font-black text-sm uppercase tracking-widest">等待导入任务</h4>
                 <p className="text-slate-300 text-[11px] mt-2">点击上方“导入图片”开始处理您的出海资源</p>
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
