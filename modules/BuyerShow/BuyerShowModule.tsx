import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import { GlobalApiConfig, BuyerShowPersistentState, BuyerShowTask, BuyerShowSet } from '../../types';
import BuyerShowSidebar from '../../modules/BuyerShow/BuyerShowSidebar';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { generateBuyerShowPrompts } from '../../services/arkService';
import { uploadToCos } from '../../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { createZipAndDownload } from '../../utils/imageUtils';
import { logInternalAction, logActionStart, logActionSuccess, logActionFailure, logActionInterrupted } from '../../services/loggingService';
import { hasAvailableAssetSources } from '../../utils/cloudAssetState.mjs';

// --- Sub Components for Performance Optimization ---

interface TaskItemProps {
  task: BuyerShowTask;
  index: number;
  setId: string;
  onRegenerate: (task: BuyerShowTask, setId: string, index: number) => void;
  onRecover: (task: BuyerShowTask, setId: string) => void;
  onDownload: (task: BuyerShowTask, index: number) => void;
  onPreview: (url: string) => void;
}

// Memoized Task Item to prevent re-rendering unchanged siblings
const BuyerShowTaskItem = memo(({ task, index, setId, onRegenerate, onRecover, onDownload, onPreview }: TaskItemProps) => {
  const [hasError, setHasError] = useState(false);
  
  useEffect(() => {
    setHasError(false);
  }, [task.resultUrl]);

  return (
    <div className={`bg-white rounded-3xl border transition-all duration-300 overflow-hidden flex flex-col group relative ${task.status === 'completed' ? 'border-slate-200 shadow-lg' : 'border-slate-100 border-dashed'}`}>
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <span className="w-6 h-6 bg-slate-900/80 backdrop-blur text-white rounded-lg flex items-center justify-center text-[10px] font-black">{index + 1}</span>
        {task.hasFace && <span className="px-2 py-1 bg-amber-500/90 text-white rounded-md text-[9px] font-bold shadow-sm">模特基准</span>}
      </div>
      
      <div className="relative aspect-[3/4] bg-slate-50 overflow-hidden cursor-pointer group/overlay" onClick={() => task.resultUrl && onPreview(task.resultUrl)}>
        {task.status === 'completed' && task.resultUrl ? (
          <div className="relative w-full h-full group/img">
            {hasError && task.resultUrl.startsWith('blob:') ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 text-slate-400 p-4 text-center">
                <i className="far fa-file-image text-2xl mb-2"></i>
                <p className="text-[10px] font-bold">预览已失效</p>
                <p className="text-[8px] mt-1">请重新生成或找回</p>
              </div>
            ) : (
              <img 
                src={task.resultUrl} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-105" 
                alt="Generated result" 
                key={task.resultUrl}
                onError={() => {
                  if (task.resultUrl?.startsWith('blob:')) {
                    setHasError(true);
                  }
                }}
              />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/overlay:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); onRegenerate(task, setId, index); }} className="px-4 py-1.5 bg-white/20 hover:bg-white text-white hover:text-amber-600 backdrop-blur-md rounded-full text-[10px] font-bold transition-all"><i className="fas fa-redo mr-1"></i> 重新生成</button>
              <button onClick={(e) => { e.stopPropagation(); onPreview(task.resultUrl!); }} className="px-4 py-1.5 bg-white/20 hover:bg-white text-white hover:text-slate-900 backdrop-blur-md rounded-full text-[10px] font-bold transition-all"><i className="fas fa-eye mr-1"></i> 查看大图</button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
            {task.status === 'generating' ? (
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-amber-100 border-t-amber-500 rounded-full animate-spin mb-3"></div>
                <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest animate-pulse">Rendering...</p>
              </div>
            ) : task.status === 'error' ? (
              <div className="flex flex-col items-center gap-2">
                <div className="text-rose-400"><i className="fas fa-exclamation-triangle text-2xl mb-1"></i><p className="text-[9px] font-bold">生成失败</p></div>
                <p className="text-[8px] text-slate-400 max-w-[120px] leading-tight">{task.error}</p>
                <div className="flex flex-col gap-1 mt-1">
                  <button onClick={(e) => { e.stopPropagation(); onRegenerate(task, setId, index); }} className="px-3 py-1 bg-rose-50 text-rose-600 text-[9px] font-bold rounded hover:bg-rose-100">重试</button>
                  {task.taskId && <button onClick={(e) => { e.stopPropagation(); onRecover(task, setId); }} className="px-3 py-1 bg-slate-50 text-slate-500 text-[9px] font-bold rounded hover:bg-slate-100">找回</button>}
                </div>
              </div>
            ) : (
              <div className="opacity-30"><i className="fas fa-image text-2xl mb-1"></i><p className="text-[9px] font-bold">等待处理</p></div>
            )}
          </div>
        )}
      </div>
      
      <div className="p-4 flex-1 flex flex-col justify-between bg-white">
        <p className="text-[10px] font-medium text-slate-500 leading-snug line-clamp-2 mb-3 h-8" title={task.styleDescription}>{task.styleDescription}</p>
        <div className="flex gap-2">
          {task.status === 'completed' ? (
            <button onClick={(e) => { e.stopPropagation(); onDownload(task, index); }} className="flex-1 py-2 bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white text-[10px] font-black rounded-lg transition-all flex items-center justify-center gap-2"><i className="fas fa-download"></i> 下载</button>
          ) : (
            <button disabled className="flex-1 py-2 bg-slate-50 text-slate-300 text-[10px] font-bold rounded-lg cursor-not-allowed">...</button>
          )}
        </div>
      </div>
    </div>
  );
});

interface SetItemProps {
  set: BuyerShowSet;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onCopyText: (text: string) => void;
  onCancelSet: (setId: string) => void;
  onDeleteSet: (setId: string) => void;
  // Pass down task handlers
  onRegenerate: (task: BuyerShowTask, setId: string, index: number) => void;
  onRecover: (task: BuyerShowTask, setId: string) => void;
  onDownload: (task: BuyerShowTask, index: number) => void;
  onPreview: (url: string) => void;
  onGenerateRemaining: (setId: string) => void;
}

// Memoized Set Item to prevent re-rendering when other sets update
const BuyerShowSetItem = memo(({ set, isExpanded, onToggleExpand, onCopyText, onCancelSet, onDeleteSet, onRegenerate, onRecover, onDownload, onPreview, onGenerateRemaining }: SetItemProps) => {
  const isFirstCompleted = set.tasks[0]?.status === 'completed';
  const hasRemainingErrors = set.tasks.slice(1).some(t => t.status === 'error' || t.status === 'pending');
  const isGeneratingRemaining = set.tasks.slice(1).some(t => t.status === 'generating');
  const isSetGenerating = set.tasks.some(task => task.status === 'generating') || set.status === 'generating';

  return (
    <div className={`bg-white rounded-[32px] border shadow-xl overflow-hidden mb-8 transition-all duration-300 ${isExpanded ? 'border-amber-200 ring-4 ring-amber-50' : 'border-slate-100 hover:border-amber-200'}`}>
      <div 
        className="bg-amber-50/50 p-6 border-b border-amber-100 flex items-center justify-between cursor-pointer hover:bg-amber-50 transition-colors"
        onClick={() => onToggleExpand(set.id)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm transition-all ${isExpanded ? 'bg-amber-500 text-white' : 'bg-white text-amber-500 border border-amber-200'}`}>#{set.index}</div>
          <span className="text-sm font-black text-slate-800">买家秀方案 {set.index}</span>
          {set.status === 'completed' && <i className="fas fa-check-circle text-emerald-500 text-lg"></i>}
          {set.status === 'generating' && <span className="text-xs font-bold text-amber-600 animate-pulse">流水线作业中...</span>}
        </div>
        <div className="flex items-center gap-4">
          {isExpanded && isSetGenerating && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancelSet(set.id); }}
              className="text-[10px] font-black text-white bg-rose-600 px-3 py-1.5 rounded-lg shadow-sm hover:bg-rose-700 transition-all flex items-center gap-1"
            >
              <i className="fas fa-stop"></i>
              中断项目
            </button>
          )}

          {isExpanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteSet(set.id); }}
              className="text-[10px] font-black text-rose-600 bg-white px-3 py-1.5 rounded-lg shadow-sm hover:bg-rose-50 transition-all border border-rose-200 flex items-center gap-1"
            >
              <i className="fas fa-trash"></i>
              删除项目
            </button>
          )}

          {/* Show "Generate Remaining" button if first is done but others failed/pending */}
          {isFirstCompleted && hasRemainingErrors && isExpanded && (
             <button 
                onClick={(e) => { e.stopPropagation(); onGenerateRemaining(set.id); }} 
                disabled={isGeneratingRemaining}
                className="text-[10px] font-black text-white bg-emerald-500 px-3 py-1.5 rounded-lg shadow-sm hover:bg-emerald-600 transition-all disabled:bg-slate-300 flex items-center gap-1"
             >
                {isGeneratingRemaining ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-layer-group"></i>}
                {isGeneratingRemaining ? '正在生成后续...' : '生成后续套图'}
             </button>
          )}

          {set.evaluationText && isExpanded && (
            <button onClick={(e) => { e.stopPropagation(); onCopyText(set.evaluationText); }} className="text-[10px] font-black text-amber-700 bg-white px-3 py-1.5 rounded-lg shadow-sm hover:bg-amber-100 transition-all border border-amber-200"><i className="fas fa-copy mr-1"></i> 复制文案</button>
          )}
          <i className={`fas fa-chevron-down text-amber-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}></i>
        </div>
      </div>
      
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          {set.evaluationText && (
            <div className="px-8 py-4 bg-slate-50/30 border-b border-slate-50">
              <p className="text-xs font-medium text-slate-600 leading-relaxed italic">“{set.evaluationText}”</p>
            </div>
          )}

          <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {set.tasks.map((task, idx) => (
              <BuyerShowTaskItem 
                key={task.id} 
                task={task} 
                index={idx}
                setId={set.id}
                onRegenerate={onRegenerate}
                onRecover={onRecover}
                onDownload={onDownload}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// --- Main Module ---

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: BuyerShowPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<BuyerShowPersistentState>>;
}

const BuyerShowModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const { subMode, productImages, referenceImage, sets, isAnalyzing, isGenerating } = persistentState;
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null);
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const generationAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const setAbortControllersRef = useRef<Map<string, Set<AbortController>>>(new Map());
  const currentPlanAbortControllerRef = useRef<AbortController | null>(null);

  const hasActiveGeneration = useCallback((setsToCheck: BuyerShowSet[]) => {
    return setsToCheck.some(set => set.tasks.some(task => task.status === 'generating'));
  }, []);

  const writeLog = useCallback((payload: {
    level: 'info' | 'error';
    module: string;
    action: string;
    message: string;
    detail?: string;
    status: 'success' | 'failed' | 'started' | 'interrupted';
    meta?: Record<string, unknown>;
  }) => {
    void logInternalAction(payload);
  }, []);
  
  // Use callback to stabilize handlers
  const updateState = useCallback((updates: Partial<BuyerShowPersistentState>) => {
    onStateChange(prev => ({ ...prev, ...updates }));
  }, [onStateChange]);

  const verifyManagedAssetUrl = useCallback(async (url: string) => {
    const trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) return '';

    const normalizedUrl = trimmedUrl.replace(':3100/api/assets/file/', '/api/assets/file/');
    if (!normalizedUrl.includes('/api/assets/file/')) {
      return normalizedUrl;
    }

    try {
      const response = await fetch(normalizedUrl, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return normalizedUrl;
    } catch {
      throw new Error('旧素材记录已失效，请重新导入产品图后再试。');
    }
  }, []);

  const ensureUploadedAssets = useCallback(async (state: BuyerShowPersistentState) => {
    let productUrls: string[] = [];
    if (state.productImages.length > 0) {
      productUrls = await Promise.all(
        state.productImages.map(async (img, i) => {
          if (state.uploadedProductUrls?.[i]) {
            try {
              return await verifyManagedAssetUrl(state.uploadedProductUrls[i]);
            } catch (error) {
              if (!img) {
                throw error;
              }
            }
          }
          return uploadToCos(img, apiConfig);
        })
      );
    } else if (state.uploadedProductUrls?.length) {
      productUrls = await Promise.all(
        state.uploadedProductUrls
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
          .map((url) => verifyManagedAssetUrl(url))
      );
    }

    let refUrl = state.uploadedReferenceUrl || null;
    if (refUrl) {
      refUrl = await verifyManagedAssetUrl(refUrl);
    }
    if (state.referenceImage && !refUrl) {
      refUrl = await uploadToCos(state.referenceImage, apiConfig);
    }

    onStateChange(prev => ({
      ...prev,
      uploadedProductUrls: productUrls,
      uploadedReferenceUrl: refUrl,
    }));

    return { productUrls, refUrl };
  }, [apiConfig, onStateChange, verifyManagedAssetUrl]);

  const createTrackedAbortController = useCallback((setId?: string) => {
    const controller = new AbortController();
    generationAbortControllersRef.current.add(controller);
    if (setId) {
      const setControllers = setAbortControllersRef.current.get(setId) || new Set<AbortController>();
      setControllers.add(controller);
      setAbortControllersRef.current.set(setId, setControllers);
    }
    controller.signal.addEventListener('abort', () => {
      generationAbortControllersRef.current.delete(controller);
      if (setId) {
        const setControllers = setAbortControllersRef.current.get(setId);
        if (setControllers) {
          setControllers.delete(controller);
          if (setControllers.size === 0) {
            setAbortControllersRef.current.delete(setId);
          }
        }
      }
    }, { once: true });
    return controller;
  }, []);

  const cancelWorkflow = useCallback(() => {
    currentPlanAbortControllerRef.current?.abort();
    currentPlanAbortControllerRef.current = null;

    generationAbortControllersRef.current.forEach(controller => controller.abort());
    generationAbortControllersRef.current.clear();
    setAbortControllersRef.current.clear();

    onStateChange(prev => ({
      ...prev,
      isAnalyzing: false,
      isGenerating: false,
      sets: prev.sets.map(set => ({
        ...set,
        status: set.tasks.some(task => task.status === 'completed') ? 'completed' : 'pending',
        tasks: set.tasks.map(task => (
          task.status === 'generating'
            ? { ...task, status: 'error', error: '已手动中断' }
            : task
        ))
      }))
    }));
    void logActionInterrupted({
      module: 'buyer_show',
      action: 'interrupt_workflow',
      message: '手动中断买家秀整套流程',
      meta: {
        setCount: stateRef.current.sets.length,
      },
    });
  }, [onStateChange]);

  useEffect(() => {
    // 强制重置分析和生成状态，防止刷新后状态锁定
    onStateChange(prev => ({ ...prev, isAnalyzing: false, isGenerating: false }));

    // 自动恢复刷新前正在生成的任务
    if (sets && Array.isArray(sets)) {
      sets.forEach(set => {
        if (set.tasks && Array.isArray(set.tasks)) {
          set.tasks.forEach(task => {
            if (task.status === 'generating' && task.taskId && !inflightIdsRef.current.has(task.id)) {
               inflightIdsRef.current.add(task.id);
               handleRecoverTask(task, set.id);
            }
          });
        }
      });
    }
    return () => {
      currentPlanAbortControllerRef.current?.abort();
      generationAbortControllersRef.current.forEach(controller => controller.abort());
      generationAbortControllersRef.current.clear();
      setAbortControllersRef.current.clear();
    };
  }, []); // 仅在组件挂载时执行一次

  const cancelSetGeneration = useCallback((setId: string) => {
    const targetControllers = setAbortControllersRef.current.get(setId);
    if (targetControllers) {
      targetControllers.forEach(controller => controller.abort());
      setAbortControllersRef.current.delete(setId);
    }

    onStateChange(prev => {
      const nextSets = prev.sets.map(set => (
        set.id === setId
          ? {
              ...set,
              status: set.tasks.some(task => task.status === 'completed') ? 'completed' : 'pending',
              tasks: set.tasks.map(task => (
                task.status === 'generating'
                  ? { ...task, status: 'error', error: '已手动中断' }
                  : task
              ))
            }
          : set
      ));

      return {
        ...prev,
        sets: nextSets,
        isGenerating: nextSets.some(set => set.tasks.some(task => task.status === 'generating')),
      };
    });
    void logActionInterrupted({
      module: 'buyer_show',
      action: 'interrupt_set',
      message: '手动中断买家秀方案',
      meta: {
        setId,
      },
    });
  }, [onStateChange]);

  const deleteSet = useCallback((setId: string) => {
    cancelSetGeneration(setId);
    onStateChange(prev => {
      const nextSets = prev.sets.filter(set => set.id !== setId);
      return {
        ...prev,
        sets: nextSets,
        tasks: nextSets[0]?.tasks || [],
        evaluationText: nextSets[0]?.evaluationText || '',
        isGenerating: nextSets.some(set => set.tasks.some(task => task.status === 'generating')),
      };
    });
    setExpandedSetId(prev => (prev === setId ? null : prev));
    void logActionSuccess({
      module: 'buyer_show',
      action: 'delete_set',
      message: '删除买家秀方案',
      meta: {
        setId,
      },
    });
  }, [cancelSetGeneration, onStateChange]);

  const handleStartWorkflow = async () => {
    if (inflightIdsRef.current.has('__workflow__')) return;
    const latestState = stateRef.current;
    if (latestState.isAnalyzing || latestState.isGenerating || !hasAvailableAssetSources(latestState.productImages, latestState.uploadedProductUrls)) return;
    inflightIdsRef.current.add('__workflow__');

    currentPlanAbortControllerRef.current?.abort();
    currentPlanAbortControllerRef.current = null;
    generationAbortControllersRef.current.forEach(controller => controller.abort());
    generationAbortControllersRef.current.clear();
    setAbortControllersRef.current.clear();
    inflightIdsRef.current.clear();
    
    // 初始化多套方案
    const newSets: BuyerShowSet[] = [];
    const count = latestState.setCount || 1;
    
    onStateChange({ 
        ...latestState, 
        isAnalyzing: true, 
        sets: [], 
        pureEvaluations: [],
        tasks: [], 
        evaluationText: '',
        firstImageConfirmed: false,
        isGenerating: false
    });

    try {
      writeLog({
        level: 'info',
        module: 'buyer_show',
        action: 'plan_start',
        message: `开始执行买家秀策划，共 ${count} 套方案`,
        status: 'started',
        meta: {
          setCount: count,
          imageCount: latestState.imageCount,
          hasReferenceImage: Boolean(latestState.referenceImage || latestState.uploadedReferenceUrl),
          includeModel: latestState.includeModel,
        },
      });

      const { productUrls, refUrl } = await ensureUploadedAssets(latestState);
      const planAbortController = new AbortController();
      currentPlanAbortControllerRef.current = planAbortController;
      
      const plans = [];
      for (let idx = 0; idx < count; idx += 1) {
        const planResult = await generateBuyerShowPrompts(productUrls, refUrl, latestState, apiConfig, idx, planAbortController.signal);
        if (planAbortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        plans.push(planResult);
      }
      currentPlanAbortControllerRef.current = null;

      plans.forEach((res, index) => {
        if (res.status === 'error' || res.tasks.length === 0) return;

        let sortedPlans = [...res.tasks];
        if (latestState.includeModel) {
          const firstFaceIndex = sortedPlans.findIndex(p => p.hasFace);
          if (firstFaceIndex > 0) {
            const facePlan = sortedPlans.splice(firstFaceIndex, 1)[0];
            sortedPlans.unshift(facePlan);
          }
        }

        const setTasks: BuyerShowTask[] = sortedPlans.map(t => ({
          id: Math.random().toString(36).substr(2, 9),
          prompt: t.prompt,
          styleDescription: t.style,
          hasFace: t.hasFace,
          status: 'pending'
        }));

        newSets.push({
          id: Math.random().toString(36).substr(2, 9),
          index: index + 1,
          tasks: setTasks,
          evaluationText: res.evaluation,
          status: 'pending'
        });
      });

      if (newSets.length === 0) throw new Error("AI 策划方案生成失败，请重试。");

      writeLog({
        level: 'info',
        module: 'buyer_show',
        action: 'plan_success',
        message: `买家秀策划成功，已生成 ${newSets.length} 套方案`,
        status: 'success',
        meta: {
          setCount: newSets.length,
          imageCount: latestState.imageCount,
        },
      });

      setExpandedSetId(newSets[0].id);

      onStateChange(prev => ({ 
        ...prev, 
        sets: newSets,
        tasks: newSets[0].tasks,
        evaluationText: newSets[0].evaluationText,
        isAnalyzing: false, 
        isGenerating: true 
      }));

      newSets.forEach((set) => runSetGeneration(set, productUrls, refUrl));

    } catch (err: any) {
      currentPlanAbortControllerRef.current = null;
      if (err?.name === 'AbortError') {
        writeLog({
          level: 'info',
          module: 'buyer_show',
          action: 'plan_interrupt',
          message: '买家秀策划被手动中断',
          status: 'interrupted',
        });
        updateState({ isAnalyzing: false, isGenerating: false });
        return;
      }
      writeLog({
        level: 'error',
        module: 'buyer_show',
        action: 'plan_failed',
        message: '买家秀策划失败',
        detail: err?.message || '未知错误',
        status: 'failed',
        meta: {
          setCount: count,
          imageCount: latestState.imageCount,
        },
      });
      alert("策划失败: " + err.message);
      updateState({ isAnalyzing: false, isGenerating: false });
    } finally {
      inflightIdsRef.current.delete('__workflow__');
    }
  };

  const runSetGeneration = async (set: BuyerShowSet, productUrls: string[], globalRefUrl: string | null) => {
    const setId = set.id;
    const tasks = set.tasks;

    const updateSetTaskStatus = (taskId: string, status: BuyerShowTask['status'], resultUrl?: string, error?: string, taskIdValue?: string) => {
        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => s.id === setId ? {
                ...s,
                status: 'generating', 
                tasks: s.tasks.map(t => t.id === taskId ? { ...t, status, resultUrl, error, taskId: taskIdValue } : t)
            } : s)
        }));
    };

    try {
        const firstTask = tasks[0];
        updateSetTaskStatus(firstTask.id, 'generating');
        const firstController = createTrackedAbortController(setId);
        const firstRes = await triggerNewKieTask(firstTask.prompt, productUrls, globalRefUrl, true, firstController.signal);
        generationAbortControllersRef.current.delete(firstController);
        
        if (firstRes.status === 'success' && firstRes.imageUrl) {
            updateSetTaskStatus(firstTask.id, 'completed', firstRes.imageUrl, undefined, firstRes.taskId);
            
            const referenceForOthers = firstRes.imageUrl;
            
            const remainingTasks = tasks.slice(1);
            if (remainingTasks.length > 0) {
                await Promise.all(remainingTasks.map(async (task) => {
                    updateSetTaskStatus(task.id, 'generating');
                    try {
                        const taskController = createTrackedAbortController(setId);
                        const res = await triggerNewKieTask(task.prompt, productUrls, referenceForOthers, false, taskController.signal);
                        generationAbortControllersRef.current.delete(taskController);
                        if (res.status === 'success') updateSetTaskStatus(task.id, 'completed', res.imageUrl, undefined, res.taskId);
                        else if (res.status === 'interrupted') updateSetTaskStatus(task.id, 'error', undefined, '已手动中断', res.taskId);
                        else updateSetTaskStatus(task.id, 'error', undefined, res.message, res.taskId);
                    } catch (e: any) {
                        updateSetTaskStatus(task.id, 'error', undefined, e.message);
                    }
                }));
            }
        } else if (firstRes.status === 'interrupted') {
            updateSetTaskStatus(firstTask.id, 'error', undefined, '已手动中断', firstRes.taskId);
        } else {
            // 首图失败，强制标记所有后续图片为失败，并更新 Set 状态
            updateSetTaskStatus(firstTask.id, 'error', undefined, firstRes.message || '基准图生成失败', firstRes.taskId);
            
            // 核心变更：当首图失败时，直接标记后续任务为 Error，不进行生成
            const remainingTasks = tasks.slice(1);
            remainingTasks.forEach(task => {
                updateSetTaskStatus(task.id, 'error', undefined, "等待首图生成成功");
            });
        }

        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => s.id === setId ? { ...s, status: firstRes.status === 'success' ? 'completed' : 'pending' } : s),
            isGenerating: hasActiveGeneration(
              prev.sets.map(s => s.id === setId ? { ...s, status: firstRes.status === 'success' ? 'completed' : 'pending' } : s)
            )
        }));

    } catch (e) {
        console.error("Set generation failed", e);
        writeLog({
            level: 'error',
            module: 'buyer_show',
            action: 'set_generation_failed',
            message: `买家秀方案 ${set.index} 生成失败`,
            detail: e instanceof Error ? e.message : '未知错误',
            status: 'failed',
            meta: {
              setId,
              setIndex: set.index,
            },
        });
        onStateChange(prev => ({
            ...prev,
            isGenerating: hasActiveGeneration(prev.sets)
        }));
    }
  };

  // 新增：处理生成剩余图片的逻辑
  const handleGenerateRemainingOptimized = useCallback(async (setId: string) => {
    const currentState = stateRef.current;
    const currentSet = currentState.sets.find(s => s.id === setId);
    
    if (!currentSet) return;
    
    // 检查首图是否成功
    const firstTask = currentSet.tasks[0];
    if (firstTask.status !== 'completed' || !firstTask.resultUrl) {
        alert("请先重新生成第一张基准图！");
        return;
    }

    const referenceForOthers = firstTask.resultUrl;
    const tasksToRun = currentSet.tasks.slice(1).filter(t => t.status !== 'completed' && t.status !== 'generating');

    if (tasksToRun.length === 0) return;
    void logActionStart({
      module: 'buyer_show',
      action: 'generate_remaining',
      message: '开始生成后续套图',
      meta: {
        setId,
        count: tasksToRun.length,
      },
    });

    onStateChange(prev => ({
        ...prev,
        sets: prev.sets.map(s => s.id === setId ? {
            ...s,
            tasks: s.tasks.map(t => tasksToRun.find(tr => tr.id === t.id) ? { ...t, status: 'generating', error: undefined } : t)
        } : s)
    }));

    try {
        const { productUrls } = await ensureUploadedAssets(currentState);
        
        await Promise.all(tasksToRun.map(async (task) => {
            try {
                const taskController = createTrackedAbortController(setId);
                const res = await triggerNewKieTask(task.prompt, productUrls, referenceForOthers, false, taskController.signal);
                generationAbortControllersRef.current.delete(taskController);
                
                onStateChange(prev => ({
                    ...prev,
                    sets: prev.sets.map(s => s.id === setId ? {
                        ...s,
                        tasks: s.tasks.map(t => t.id === task.id ? { 
                            ...t, 
                            status: res.status === 'success' ? 'completed' : 'error', 
                            resultUrl: res.imageUrl,
                            taskId: res.taskId,
                            error: res.status === 'interrupted' ? '已手动中断' : res.message
                        } : t)
                    } : s)
                }));
            } catch (e: any) {
                onStateChange(prev => ({
                    ...prev,
                    sets: prev.sets.map(s => s.id === setId ? {
                        ...s,
                        tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'error', error: e.message } : t)
                    } : s)
                }));
            }
        }));
        // 所有并行任务完成后，检查 set 是否全部完成
        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => {
                if (s.id !== setId) return s;
                const allCompleted = s.tasks.every(t => t.status === 'completed');
                return allCompleted ? { ...s, status: 'completed' as const } : s;
            })
        }));
        void logActionSuccess({
          module: 'buyer_show',
          action: 'generate_remaining',
          message: '后续套图生成完成',
          meta: {
            setId,
            count: tasksToRun.length,
          },
        });
    } catch (e: any) {
        void logActionFailure({
          module: 'buyer_show',
          action: 'generate_remaining',
          message: '后续套图生成失败',
          detail: e.message,
          meta: {
            setId,
            count: tasksToRun.length,
          },
        });
        alert("启动后续任务失败: " + e.message);
    }
  }, [createTrackedAbortController, ensureUploadedAssets, onStateChange]);

  const triggerNewKieTask = async (prompt: string, productUrls: string[], refUrl: string | null, isFirstImage: boolean, signal?: AbortSignal) => {
    const isModelMode = persistentState.includeModel;
    // 基础 Prompt - 调整为强调 iPhone 随手拍质感，但保持整洁，并强调环境融合与物理真实感
    let realismPrompt = `High quality authentic iPhone photo, aesthetic social media snapshot. **Perfect environmental integration**, **physically accurate shadows and reflections**, **product naturally interacting with surfaces**. Clean and tidy daily life environment, natural lighting, clear details, realistic texture. NO messy background, NO trash, NO clutter, NO floating product, NO sticker effect.`;
    
    let refDescription = "";
    if (refUrl) {
      if (isFirstImage) {
         refDescription = `VISUAL REFERENCE PRIORITY: High. Visual atmosphere reference image (URL=${refUrl}) determines the environment style and lighting vibe. Adapt the product into a similar **clean and aesthetic** environment with perfect lighting match.`;
      } else {
         refDescription = `SCENE & CHARACTER CONSISTENCY: Reference benchmark image (URL=${refUrl}) establishes the reality of this set.
         Reference benchmark image (URL=${refUrl}) is the first generated image from this same buyer-show set.
         Treat that benchmark image as the single source of truth for person identity, room layout, props, lighting, and camera reality.
         1. **MAINTAIN EXACT CONTINUITY**: Keep the same person (if present), the same specific room/location, the same tableware/props/background objects, and the same lighting conditions unless the new prompt explicitly asks for a change.
         2. **DO NOT RESET THE SESSION**: Do not invent a new room, new person, or unrelated setup. This must feel like the next shot from the same real-life session.
         3. **FORCE SHOT DIFFERENTIATION**: This new shot MUST stay in the same session continuity but clearly differ in composition, framing, action focus, and product storytelling purpose. Do NOT simply clone the benchmark composition.`;
      }
    }

    let baseRequirement = "";
    if (isModelMode) {
        baseRequirement = isFirstImage 
          ? `AUTHENTIC LIFESTYLE SNAPSHOT (BENCHMARK): A real user in ${persistentState.targetCountry} posing naturally in a nice, clean setting. If a person is shown, they should look like a local user from ${persistentState.targetCountry}. Casual "influencer" style. ${refDescription}` 
          : `VISUAL CONSISTENCY & VARIATION: ${refDescription}`;
    } else {
        baseRequirement = `HIGH QUALITY STILL LIFE: Focus on product in a real-world setting. NO FACES. The product must look like it is physically sitting in the scene, not pasted. ${refDescription}`;
    }
    
    const productPreservation = `STRICT PRODUCT INTEGRITY: The product MUST maintain its exact physical form, details, and labels from source images, while receiving accurate lighting and shadows from the environment.`;
    const finalPrompt = `${realismPrompt}\n${baseRequirement}\n${productPreservation}\n\nSHOT-SPECIFIC REQUIREMENT: You must execute this exact new shot objective and make the frame visibly different from the benchmark while keeping the same session continuity.\nScenario: ${prompt}`;
    
    const inputs = [...productUrls];
    if (refUrl) inputs.push(refUrl);

    writeLog({
      level: 'info',
      module: 'buyer_show',
      action: 'create_image_task',
      message: '组装买家秀图像任务',
      status: 'started',
      meta: {
        isFirstImage,
        referenceUrl: refUrl || '',
        inputImageUrls: inputs,
        finalPrompt,
      },
    });

    return await processWithKieAi(
      inputs, 
      apiConfig, 
      { 
        targetLanguage: 'zh', 
        customLanguage: '', 
        removeWatermark: true, 
        aspectRatio: persistentState.aspectRatio, 
        quality: persistentState.quality, 
        model: persistentState.model,
        resolutionMode: 'original', 
        targetWidth: 0, 
        targetHeight: 0,
        maxFileSize: 2.0
      }, 
      false, 
      signal || new AbortController().signal, 
      finalPrompt
    );
  };

  const handleDownloadSingle = useCallback(async (task: BuyerShowTask, index: number) => {
    if (!task.resultUrl) return;
    void logActionSuccess({
      module: 'buyer_show',
      action: 'download_single',
      message: '下载买家秀单图',
      meta: {
        taskId: task.id,
        index: index + 1,
      },
    });
    try {
      const resp = await fetch(task.resultUrl);
      const blob = await resp.blob();
      const localUrl = safeCreateObjectURL(blob);
      const a = document.createElement('a'); a.href = localUrl; a.download = `buyer_show_${index + 1}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(localUrl);
    } catch (e) { alert("下载失败"); }
  }, []);

  const handleBatchDownload = async () => {
    setIsBatchDownloading(true);
    void logActionStart({
      module: 'buyer_show',
      action: 'download_batch',
      message: '开始打包下载买家秀结果',
      meta: {
        setCount: persistentState.sets.length,
      },
    });
    try {
      const files: { blob: Blob; path: string }[] = [];
      const completedSets = persistentState.sets.filter(s => s.status === 'completed' || s.tasks.some(t => t.status === 'completed'));
      if (completedSets.length === 0) throw new Error("无可用方案");

      for (const set of completedSets) {
          const setFolder = `方案${set.index}_买家秀`;
          if (set.evaluationText) {
              files.push({ blob: new Blob([set.evaluationText], { type: 'text/plain' }), path: `${setFolder}/评价文案.txt` });
          }
          const completedTasks = set.tasks.filter(t => t.status === 'completed' && t.resultUrl);
          for (let i = 0; i < completedTasks.length; i++) {
              const task = completedTasks[i];
              try {
                  const response = await fetch(task.resultUrl!, { mode: 'cors', cache: 'no-cache' });
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  const blob = await response.blob();
                  const fileName = `图${i+1}_${task.hasFace ? '含模特' : '细节'}.png`;
                  files.push({ blob, path: `${setFolder}/${fileName}` });
              } catch (e) { console.error(e); }
          }
      }
      await createZipAndDownload(files, `mayo_buyershow_${Date.now()}`);
      void logActionSuccess({
        module: 'buyer_show',
        action: 'download_batch',
        message: '打包下载买家秀结果成功',
        meta: {
          fileCount: files.length,
        },
      });
    } catch (err: any) {
      void logActionFailure({
        module: 'buyer_show',
        action: 'download_batch',
        message: '打包下载买家秀结果失败',
        detail: err.message,
        meta: {
          setCount: persistentState.sets.length,
        },
      });
      alert(`打包下载失败: ${err.message}`);
    } finally { setIsBatchDownloading(false); }
  };

  const handleRecoverTask = useCallback(async (task: BuyerShowTask, setId: string) => {
    if (!task.taskId) return;
    void logActionStart({
      module: 'buyer_show',
      action: 'recover_single',
      message: '尝试找回买家秀单图结果',
      meta: {
        setId,
        taskId: task.id,
        kieTaskId: task.taskId,
      },
    });
    inflightIdsRef.current.add(task.id);
    onStateChange(prev => ({
        ...prev,
        sets: prev.sets.map(s => s.id === setId ? {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'generating', error: undefined } : t)
        } : s)
    }));
    try {
        const res = await recoverKieAiTask(task.taskId, apiConfig, new AbortController().signal);
        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => s.id === setId ? {
                ...s,
                tasks: s.tasks.map(t => t.id === task.id ? { 
                    ...t, 
                    status: res.status === 'success' ? 'completed' : 'error', 
                    resultUrl: res.imageUrl,
                    taskId: res.taskId,
                    error: res.message
                } : t)
            } : s)
        }));
        void logActionSuccess({
          module: 'buyer_show',
          action: 'recover_single',
          message: res.status === 'success' ? '找回买家秀单图成功' : '找回买家秀单图失败',
          meta: {
            setId,
            taskId: task.id,
            kieTaskId: res.taskId,
          },
        });
    } catch (e: any) {
        writeLog({
            level: 'error',
            module: 'buyer_show',
            action: 'task_regenerate_failed',
            message: `买家秀单图重试失败`,
            detail: e.message || '未知错误',
            status: 'failed',
            meta: {
              setId,
              taskId: task.id,
            },
        });
        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => s.id === setId ? {
                ...s,
                tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'error', error: e.message } : t)
            } : s)
        }));
    } finally {
        inflightIdsRef.current.delete(task.id);
    }
  }, [apiConfig, onStateChange]);

  const handleRegenerateTask = useCallback(async (task: BuyerShowTask, setId: string, taskIndex: number) => {
    // Note: accessing state inside callback requires careful dependency management or refs.
    // However, since handleRegenerate needs latest 'persistentState.productImages' which changes rarely during generation,
    // we can access it via a ref or by just letting this function recreate when persistentState changes.
    // For pure optimization, we should pass needed data as arguments or use a ref for the full state.
    // Here we will use a workaround: The caller (TaskItem) doesn't know the images. 
    // We will assume productImages are available in the scope (closure).
    // BUT since 'handleRegenerateTask' is recreated when 'persistentState' changes, we are fine functionally.
    // The key is that TaskItems for OTHER sets won't re-render if we use React.memo and the prop (this function) didn't change?
    // Actually, if persistentState changes, this function reference changes, so ALL TaskItems re-render.
    // To truly fix this, we need to decouple the handler or use a Ref for state access.
    
    // We will assume the heavy rendering is the issue and just isolating components helps enough even with prop updates.
    // To go further, we'd need a ref for state. Let's do that for maximum performance.
    // See stateRef below.
    
    // Implementation is in the useEffect/Ref block below to access current state without triggering re-renders.
  }, []); // Placeholder, actual logic moved to component body with ref

  // Ref to hold latest state for callbacks to avoid dependency chain
  const stateRef = useRef(persistentState);
  useEffect(() => { stateRef.current = persistentState; }, [persistentState]);

  const handleRegenerateTaskOptimized = useCallback(async (task: BuyerShowTask, setId: string, taskIndex: number) => {
    const currentState = stateRef.current;
    void logActionStart({
      module: 'buyer_show',
      action: 'retry_single',
      message: '重新生成买家秀单图',
      meta: {
        setId,
        taskId: task.id,
        index: taskIndex + 1,
      },
    });
    
    onStateChange(prev => ({
        ...prev,
        sets: prev.sets.map(s => s.id === setId ? {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'generating', error: undefined } : t)
        } : s)
    }));

    try {
        const { productUrls, refUrl } = await ensureUploadedAssets(currentState);
        let refUrlToUse = null;
        
        // Logic to find reference
        const currentSet = currentState.sets.find(s => s.id === setId);
        const isFirstImage = taskIndex === 0;

        if (isFirstImage) {
            refUrlToUse = refUrl;
        } else {
            const firstTask = currentSet?.tasks[0];
            if (firstTask?.status === 'completed' && firstTask.resultUrl) {
                refUrlToUse = firstTask.resultUrl;
            } else {
                refUrlToUse = refUrl;
            }
        }

        const taskController = createTrackedAbortController(setId);
        const res = await triggerNewKieTask(task.prompt, productUrls, refUrlToUse, isFirstImage, taskController.signal);
        generationAbortControllersRef.current.delete(taskController);

        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => {
                if (s.id !== setId) return s;
                const updatedTasks = s.tasks.map(t => t.id === task.id ? {
                    ...t,
                    status: res.status === 'success' ? 'completed' as const : 'error' as const,
                    resultUrl: res.imageUrl,
                    taskId: res.taskId,
                    error: res.status === 'interrupted' ? '已手动中断' : res.message
                } : t);
                const allCompleted = updatedTasks.every(t => t.status === 'completed');
                return { ...s, tasks: updatedTasks, status: allCompleted ? 'completed' as const : s.status };
            })
        }));
        void logActionSuccess({
          module: 'buyer_show',
          action: 'retry_single',
          message: res.status === 'success' ? '重新生成买家秀单图成功' : '重新生成买家秀单图失败',
          meta: {
            setId,
            taskId: task.id,
            kieTaskId: res.taskId,
          },
        });
    } catch (e: any) {
        void logActionFailure({
          module: 'buyer_show',
          action: 'retry_single',
          message: '重新生成买家秀单图失败',
          detail: e.message,
          meta: {
            setId,
            taskId: task.id,
            index: taskIndex + 1,
          },
        });
        onStateChange(prev => ({
            ...prev,
            sets: prev.sets.map(s => s.id === setId ? {
                ...s,
                tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'error', error: e.message } : t)
            } : s)
        }));
    }
  }, [createTrackedAbortController, ensureUploadedAssets, onStateChange, writeLog]); // Stable dependencies

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedSetId(prev => prev === id ? null : id);
  }, []);

  const handleCopyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    void logActionSuccess({
      module: 'buyer_show',
      action: 'copy_text',
      message: '复制买家秀文案',
      meta: {
        textLength: text.length,
      },
    });
    alert("已复制");
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <BuyerShowSidebar 
          state={persistentState}
          onUpdate={updateState}
          onStart={handleStartWorkflow}
          isProcessing={isAnalyzing || isGenerating}
          apiConfig={apiConfig}
        />

        <main className="flex-1 overflow-y-auto p-8 bg-slate-50 relative scrollbar-hide">
          <div className="max-w-7xl mx-auto space-y-8 pb-20">
            <div className="flex items-center justify-between bg-white px-6 py-4 rounded-[32px] border border-slate-100 shadow-xl sticky top-0 z-20 backdrop-blur-md bg-white/90">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {persistentState.includeModel ? '含模特模式' : '静物模式'}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {(isAnalyzing || isGenerating) && (
                  <button
                    onClick={cancelWorkflow}
                    className="px-5 py-2.5 bg-rose-600 text-white font-semibold text-xs rounded-xl hover:bg-rose-700 shadow-xl shadow-rose-100 transition-all tracking-[0.16em] flex items-center gap-2"
                  >
                    <i className="fas fa-stop"></i>
                    中断生成
                  </button>
                )}
                {sets && sets.some(s => s.status === 'completed' || s.tasks.some(t => t.status === 'completed')) && (
                  <button onClick={handleBatchDownload} disabled={isBatchDownloading} className="px-5 py-2.5 bg-emerald-600 text-white font-semibold text-xs rounded-xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all tracking-[0.16em] flex items-center gap-2">{isBatchDownloading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-file-zipper"></i>}{isBatchDownloading ? '打包下载中...' : '打包下载'}</button>
                )}
              </div>
            </div>

            <div>
                {sets && sets.length > 0 ? (
                    <div className="space-y-8">
                        {sets.map(set => (
                          <BuyerShowSetItem 
                            key={set.id}
                            set={set}
                            isExpanded={set.id === expandedSetId}
                            onToggleExpand={handleToggleExpand}
                            onCopyText={handleCopyText}
                            onCancelSet={cancelSetGeneration}
                            onDeleteSet={deleteSet}
                            onRegenerate={handleRegenerateTaskOptimized}
                            onRecover={handleRecoverTask}
                            onDownload={handleDownloadSingle}
                            onPreview={setPreviewUrl}
                            onGenerateRemaining={handleGenerateRemainingOptimized}
                          />
                        ))}
                    </div>
                ) : !isAnalyzing && (
                    <div className="h-[60vh] flex flex-col items-center justify-center text-center">
                        <div className="w-32 h-32 bg-white rounded-[48px] shadow-2xl flex items-center justify-center mb-10 border border-slate-100 relative group overflow-hidden">
                            <i className="fas fa-users-viewfinder text-5xl text-amber-500 relative z-10"></i>
                            <div className="absolute inset-0 bg-amber-500/10 blur-3xl rounded-full scale-150 -z-10 group-hover:scale-125 transition-transform duration-1000"></div>
                        </div>
                        <h2 className="text-2xl font-semibold text-slate-700 tracking-tight">开始生成买家秀</h2>
                    </div>
                )}
            </div>

            {isAnalyzing && (<div className="absolute inset-0 bg-white/76 backdrop-blur-sm z-30 flex items-center justify-center rounded-[28px]"><div className="bg-white p-12 rounded-[40px] shadow-2xl text-center"><div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mb-6 animate-bounce mx-auto"><i className="fas fa-brain text-4xl text-amber-500"></i></div><h3 className="text-xl font-black text-slate-800 mb-2">正在深度策划方案...</h3><p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">Doubao AI is crafting {persistentState.setCount} unique sets</p></div></div>)}
          </div>
        </main>
      </div>
      {previewUrl && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8" onClick={() => setPreviewUrl(null)}><div className="relative max-w-5xl max-h-full flex items-center justify-center"><img src={previewUrl} className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain" onClick={(e) => e.stopPropagation()} /></div></div>}
    </div>
  );
};

export default BuyerShowModule;
