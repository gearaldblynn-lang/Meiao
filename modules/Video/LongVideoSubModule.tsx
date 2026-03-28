import React, { useState, useRef, useEffect } from 'react';
import { GlobalApiConfig, VideoPersistentState, VideoTask, KieAiResult, VideoSubMode } from '../../types';
import VideoSidebar from './VideoSidebar';
import { uploadToCos } from '../../services/tencentCosService';
import { createSoraVideoTask, recoverKieAiTask, submitVeoVideoTask, pollVeoTaskStatus } from '../../services/kieAiService';
import { generateVideoScript } from '../../services/arkService';
import { logActionFailure, logActionInterrupted, logActionStart, logActionSuccess } from '../../services/loggingService';
import { hasAvailableAssetSources } from '../../utils/cloudAssetState.mjs';

interface Props {
  apiConfig: GlobalApiConfig;
  state: VideoPersistentState;
  onUpdate: (updates: Partial<VideoPersistentState>) => void;
  onProcessingChange: (processing: boolean) => void;
}

const LongVideoSubModule: React.FC<Props> = ({ apiConfig, state, onUpdate, onProcessingChange }) => {
  const { productImages, referenceVideoFile, tasks, config, isAnalyzing, isGenerating, subMode } = state;
  const controllerRef = useRef<AbortController | null>(null);
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const submitLockRef = useRef(false);
  
  const [fakeProgress, setFakeProgress] = useState(0);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const baseMeta = {
    subMode,
    duration: config.duration,
    aspectRatio: config.aspectRatio,
  };

  const getOrUploadProductUrls = async () => {
    if (productImages.length === 0 && state.uploadedProductUrls?.length) {
      return state.uploadedProductUrls;
    }

    if (productImages.length > 0 && state.uploadedProductUrls?.length === productImages.length) {
      return state.uploadedProductUrls;
    }

    const imageUrls = await Promise.all(productImages.map((img) => uploadToCos(img, apiConfig)));
    onUpdate({ uploadedProductUrls: imageUrls });
    return imageUrls;
  };

  const getOrUploadReferenceVideoUrl = async () => {
    if (!referenceVideoFile) {
      return state.uploadedReferenceVideoUrl || null;
    }

    if (state.uploadedReferenceVideoUrl) {
      return state.uploadedReferenceVideoUrl;
    }

    const url = await uploadToCos(referenceVideoFile, apiConfig);
    onUpdate({ uploadedReferenceVideoUrl: url });
    return url;
  };
  
  useEffect(() => {
    // 强制重置分析和生成状态，防止刷新后状态锁定
    onUpdate({ isAnalyzing: false, isGenerating: false });
    onProcessingChange(false);

    // 自动恢复刷新前正在生成的任务
    if (tasks && Array.isArray(tasks)) {
      tasks.forEach(t => {
        if (t.status === 'generating' && t.taskId && !inflightIdsRef.current.has(t.id)) {
          inflightIdsRef.current.add(t.id);
          handleRecover(t);
        }
      });
    }
  }, []); // 仅在组件挂载时执行一次

  useEffect(() => {
    // 当 tasks 变化时，如果 resultUrl 变为非 blob URL，重置错误状态
    setVideoErrors(prev => {
      const next = { ...prev };
      let changed = false;
      tasks.forEach(t => {
        if (next[t.id] && t.resultUrl && !t.resultUrl.startsWith('blob:')) {
          delete next[t.id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tasks]);

  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      setFakeProgress(0);
      interval = setInterval(() => {
        setFakeProgress(prev => {
          if (prev < 92) return prev + Math.random() * (subMode === VideoSubMode.VEO ? 1.5 : 0.5);
          return prev;
        });
      }, 2000);
    } else {
      setFakeProgress(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating, subMode]);

  const handlePlanScript = async () => {
    if (isAnalyzing || isGenerating || !hasAvailableAssetSources(productImages, state.uploadedProductUrls)) return;
    void logActionStart({
      module: 'video',
      action: 'plan_script',
      message: '开始策划短视频脚本',
      meta: {
        ...baseMeta,
        imageCount: productImages.length,
      },
    });
    onUpdate({ isAnalyzing: true });
    onProcessingChange(true);
    try {
      const controller = new AbortController();
      controllerRef.current = controller;
      const imageUrls = await getOrUploadProductUrls();
      const refVideoUrl = await getOrUploadReferenceVideoUrl();
      if (controller.signal.aborted) throw new Error("INTERRUPTED");
      const res = await generateVideoScript(imageUrls, refVideoUrl, config, apiConfig, controller.signal);
      if (res.status === 'success') {
        void logActionSuccess({
          module: 'video',
          action: 'plan_script',
          message: '短视频脚本策划成功',
          meta: {
            ...baseMeta,
            sceneCount: res.scenes.length,
          },
        });
        onUpdate({ 
          config: { ...config, scenes: res.scenes, promptMode: 'manual' }, 
          isAnalyzing: false 
        });
      } else {
        void logActionFailure({
          module: 'video',
          action: 'plan_script',
          message: '短视频脚本策划失败',
          detail: res.message,
          meta: baseMeta,
        });
        throw new Error(res.message);
      }
    } catch (err: any) {
      if (err.message !== 'INTERRUPTED') {
        void logActionFailure({
          module: 'video',
          action: 'plan_script',
          message: '短视频脚本策划失败',
          detail: err.message,
          meta: baseMeta,
        });
        alert("脚本策划失败: " + err.message);
        onUpdate({ isAnalyzing: false });
      } else {
        void logActionInterrupted({
          module: 'video',
          action: 'plan_script',
          message: '短视频脚本策划已中断',
          detail: err.message,
          meta: baseMeta,
        });
      }
    } finally {
      onProcessingChange(false);
      controllerRef.current = null;
    }
  };

  const handleStartGeneration = async () => {
    if (submitLockRef.current || isGenerating || isAnalyzing || !hasAvailableAssetSources(productImages, state.uploadedProductUrls)) return;
    if (subMode === VideoSubMode.LONG_VIDEO && config.scenes.length === 0) {
      alert("请先策划分镜脚本");
      return;
    }

    submitLockRef.current = true;
    void logActionStart({
      module: 'video',
      action: 'start_video_task',
      message: '启动短视频生成任务',
      meta: {
        ...baseMeta,
        engine: subMode === VideoSubMode.VEO ? 'veo' : 'sora',
      },
    });
    onUpdate({ isGenerating: true });
    onProcessingChange(true);

    try {
      const controller = new AbortController();
      controllerRef.current = controller;

      const newTask: VideoTask = {
        id: Math.random().toString(36).substr(2, 9),
        status: 'generating',
        createTime: Date.now()
      };
      onUpdate({ tasks: [newTask, ...tasks] });

      if (subMode === VideoSubMode.VEO) {
        await executeVeoGeneration(newTask.id, controller.signal);
      } else {
        await executeSoraGeneration(newTask.id, controller.signal);
      }

    } catch (err: any) {
      if (err.message !== 'INTERRUPTED') {
        void logActionFailure({
          module: 'video',
          action: 'start_video_task',
          message: '短视频生成任务启动失败',
          detail: err.message,
          meta: baseMeta,
        });
        alert("任务启动失败: " + err.message);
        onUpdate({ isGenerating: false });
      } else {
        void logActionInterrupted({
          module: 'video',
          action: 'start_video_task',
          message: '短视频生成任务已中断',
          detail: err.message,
          meta: baseMeta,
        });
      }
    } finally {
      submitLockRef.current = false;
      onProcessingChange(false);
      controllerRef.current = null;
    }
  };

  const executeSoraGeneration = async (taskId: string, signal: AbortSignal) => {
    const imageUrls = await getOrUploadProductUrls();
    const res = await createSoraVideoTask(imageUrls, config, apiConfig, signal);
    if (res.status === 'success') {
      void logActionSuccess({
        module: 'video',
        action: 'start_video_task',
        message: 'Sora 视频生成成功',
        meta: {
          ...baseMeta,
          taskId,
          kieTaskId: res.taskId,
        },
      });
      onUpdate({ 
        tasks: state.tasks.map(t => t.id === taskId ? { ...t, status: 'completed', resultUrl: res.videoUrl, taskId: res.taskId } : t),
        isGenerating: false 
      });
    } else if (res.status !== 'interrupted') {
      throw new Error(res.message || '渲染队列超时或失败');
    }
  };

  const executeVeoGeneration = async (taskId: string, signal: AbortSignal) => {
    const imageUrls = await getOrUploadProductUrls();
    const veoJobId = await submitVeoVideoTask(
      {
        description: config.script || 'Commercial advertisement for this product.',
        spokenContent: config.script || 'Commercial advertisement for this product.',
        bgm: 'Cinematic commercial music',
      },
      config.aspectRatio === 'landscape' ? '16:9' : '9:16',
      imageUrls.slice(0, 1),
      undefined,
      apiConfig,
      signal
    );
    const videoUrl = await pollVeoTaskStatus(veoJobId, apiConfig, signal);

    onUpdate({ 
      tasks: state.tasks.map(t => t.id === taskId ? { ...t, status: 'completed', resultUrl: videoUrl, taskId: veoJobId } : t),
      isGenerating: false 
    });
    void logActionSuccess({
      module: 'video',
      action: 'start_video_task',
      message: 'Veo 视频生成成功',
      meta: {
        ...baseMeta,
        taskId,
        veoTaskId: veoJobId,
      },
    });
  };

  const handleRecover = async (task: VideoTask) => {
    if (!task.taskId) return;
    void logActionStart({
      module: 'video',
      action: 'recover_video_task',
      message: '开始找回视频结果',
      meta: {
        ...baseMeta,
        taskId: task.id,
        kieTaskId: task.taskId,
      },
    });
    inflightIdsRef.current.add(task.id);
    const controller = new AbortController();
    controllerRef.current = controller;
    onUpdate({ tasks: tasks.map(t => t.id === task.id ? { ...t, status: 'generating', error: undefined } : t), isGenerating: true });
    onProcessingChange(true);
    try {
      if (subMode === VideoSubMode.VEO) {
        const videoUrl = await pollVeoTaskStatus(task.taskId, apiConfig, controller.signal);
        onUpdate({ tasks: tasks.map(t => t.id === task.id ? { ...t, status: 'completed', resultUrl: videoUrl } : t), isGenerating: false });
        void logActionSuccess({
          module: 'video',
          action: 'recover_video_task',
          message: '找回 Veo 视频结果成功',
          meta: {
            ...baseMeta,
            taskId: task.id,
            veoTaskId: task.taskId,
          },
        });
      } else {
        const res = await recoverKieAiTask(task.taskId, apiConfig, controller.signal, true);
        if (res.status === 'success') {
          void logActionSuccess({
            module: 'video',
            action: 'recover_video_task',
            message: '找回视频结果成功',
            meta: {
              ...baseMeta,
              taskId: task.id,
              kieTaskId: res.taskId,
            },
          });
          onUpdate({ tasks: tasks.map(t => t.id === task.id ? { ...t, status: 'completed', resultUrl: res.videoUrl } : t), isGenerating: false });
        } else throw new Error(res.message);
      }
    } catch (err: any) {
      if (err.message !== 'INTERRUPTED') {
        void logActionFailure({
          module: 'video',
          action: 'recover_video_task',
          message: '找回视频结果失败',
          detail: err.message,
          meta: {
            ...baseMeta,
            taskId: task.id,
            kieTaskId: task.taskId,
          },
        });
        onUpdate({ tasks: tasks.map(t => t.id === task.id ? { ...t, status: 'error', error: err.message } : t), isGenerating: false });
      } else {
        void logActionInterrupted({
          module: 'video',
          action: 'recover_video_task',
          message: '找回视频结果已中断',
          detail: err.message,
          meta: {
            ...baseMeta,
            taskId: task.id,
            kieTaskId: task.taskId,
          },
        });
      }
    } finally {
      onProcessingChange(false);
      controllerRef.current = null;
      inflightIdsRef.current.delete(task.id);
    }
  };

  return (
    <div className="h-full w-full flex overflow-hidden bg-slate-50">
      <VideoSidebar state={state} onUpdate={onUpdate} onPlan={handlePlanScript} onStart={handleStartGeneration} isProcessing={isGenerating || isAnalyzing} />
      <main className="flex-1 overflow-y-auto p-8 bg-slate-50 scrollbar-hide relative">
        <div className="max-w-6xl mx-auto space-y-8 pb-20">
          <div className="flex items-center justify-between bg-white px-8 py-5 rounded-[32px] border border-slate-100 shadow-xl sticky top-0 z-20 backdrop-blur-md bg-white/90">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 ${subMode === VideoSubMode.VEO ? 'bg-indigo-50' : 'bg-purple-50'} rounded-2xl flex items-center justify-center`}>
                <i className={`fas ${subMode === VideoSubMode.VEO ? 'fa-magic' : 'fa-film'} ${subMode === VideoSubMode.VEO ? 'text-indigo-600' : 'text-purple-600'} text-xl`}></i>
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-800 tracking-tight">{subMode === VideoSubMode.VEO ? 'Veo 自动创作片场' : '短视频一键生成中心'}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-black rounded uppercase tracking-tighter">{subMode === VideoSubMode.VEO ? 'Veo 3.1 Fast' : 'Sora 2 Engine'}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Master Production</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => {
                void logActionSuccess({
                  module: 'video',
                  action: 'clear_video_records',
                  message: '清空短视频记录',
                  meta: {
                    ...baseMeta,
                    count: tasks.length,
                  },
                });
                onUpdate({ tasks: [] });
              }} className="px-6 py-2.5 bg-slate-100 text-slate-500 font-black text-xs rounded-xl hover:bg-slate-200 transition-all border border-slate-200 uppercase tracking-widest">清空记录</button>
              <button onClick={handleStartGeneration} disabled={isGenerating || isAnalyzing || productImages.length === 0 || (subMode === VideoSubMode.LONG_VIDEO && config.scenes.length === 0)} className="px-8 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-slate-800 shadow-xl disabled:bg-slate-200 transition-all uppercase tracking-widest">
                {isGenerating ? '正在执行渲染指令...' : '启动最终合成任务'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {tasks.map((task, idx) => (
              <div key={task.id} className="bg-white rounded-[40px] border border-slate-100 shadow-2xl overflow-hidden flex flex-col group transition-all duration-500 hover:ring-2 hover:ring-purple-500 animate-in fade-in slide-in-from-bottom-4">
                <div className="p-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 bg-slate-900 text-white rounded-xl flex items-center justify-center text-[10px] font-black tracking-tighter italic">#{tasks.length - idx}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{subMode === VideoSubMode.VEO ? 'Veo AI Production' : 'Sora 2 Production'}</span>
                  </div>
                  <button onClick={() => {
                    void logActionSuccess({
                      module: 'video',
                      action: 'delete_video_record',
                      message: '删除短视频记录',
                      meta: {
                        ...baseMeta,
                        taskId: task.id,
                      },
                    });
                    onUpdate({ tasks: tasks.filter(t => t.id !== task.id) });
                  }} className="w-8 h-8 text-slate-300 hover:text-rose-500 transition-colors"><i className="fas fa-trash-alt text-xs"></i></button>
                </div>
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                   {task.status === 'completed' && task.resultUrl ? (
                     videoErrors[task.id] && task.resultUrl.startsWith('blob:') ? (
                       <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-400 p-8 text-center">
                         <i className="fas fa-video-slash text-3xl mb-3"></i>
                         <p className="text-xs font-black uppercase tracking-widest">视频预览已失效</p>
                         <p className="text-[10px] mt-2 opacity-60">Blob URL 已过期，请尝试断点恢复</p>
                       </div>
                     ) : (
                       <video 
                         src={task.resultUrl} 
                         controls 
                         className="w-full h-full object-cover" 
                         key={task.resultUrl}
                         onError={() => {
                           if (task.resultUrl?.startsWith('blob:')) {
                             setVideoErrors(prev => ({ ...prev, [task.id]: true }));
                           }
                         }}
                       />
                     )
                   ) : (
                     <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                        {task.status === 'generating' ? (
                          <div className="w-full space-y-6">
                             <div className="w-24 h-24 relative mx-auto">
                                <div className={`absolute inset-0 border-[6px] ${subMode === VideoSubMode.VEO ? 'border-indigo-500/10' : 'border-purple-500/10'} rounded-full`}></div>
                                <div className={`absolute inset-0 border-[6px] ${subMode === VideoSubMode.VEO ? 'border-indigo-500' : 'border-purple-500'} border-t-transparent rounded-full animate-spin`}></div>
                                <i className={`fas ${subMode === VideoSubMode.VEO ? 'fa-wand-magic-sparkles text-indigo-500' : 'fa-rocket text-purple-500'} absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl animate-pulse`}></i>
                             </div>
                             <div className="px-10">
                                <h3 className="text-white text-sm font-black uppercase tracking-[0.2em] mb-3">{subMode === VideoSubMode.VEO ? 'Veo 高级创作中' : '短视频渲染合成中'}</h3>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-4 border border-white/5">
                                   <div className={`h-full bg-gradient-to-r ${subMode === VideoSubMode.VEO ? 'from-indigo-600 via-cyan-400 to-indigo-600' : 'from-purple-600 via-indigo-400 to-purple-600'} transition-all duration-1000`} style={{ width: `${fakeProgress}%` }}></div>
                                </div>
                                <div className="flex flex-col gap-2">
                                   <div className="flex items-center justify-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                      <span className="text-emerald-400 text-[9px] font-black uppercase tracking-widest">{subMode === VideoSubMode.VEO ? 'Veo 3.1 Pro Workflow' : 'Sora 2.0 Pro Workflow'}</span>
                                   </div>
                                   <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                                     正在执行光影追踪与物理引擎模拟<br/>预计剩余时长: {Math.max(1, Math.round((100 - fakeProgress) / (subMode === VideoSubMode.VEO ? 15 : 10)))} 分钟
                                   </p>
                                </div>
                             </div>
                          </div>
                        ) : task.status === 'error' ? (
                          <div className="space-y-4">
                             <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto text-rose-500 text-2xl"><i className="fas fa-exclamation-triangle"></i></div>
                             <p className="text-rose-400 text-xs font-black uppercase px-12 leading-relaxed">{task.error || '云端渲染队列异常'}</p>
                             <button onClick={() => handleRecover(task)} className="px-8 py-2.5 bg-rose-600 text-white text-[10px] font-black rounded-xl hover:bg-rose-700 shadow-xl shadow-rose-900/40 uppercase transition-all tracking-widest">尝试断点恢复</button>
                          </div>
                        ) : (
                          <div className="space-y-4 opacity-30 text-white">
                             <i className="fas fa-clapperboard text-5xl"></i>
                             <p className="text-[10px] font-black uppercase tracking-[0.3em]">Standby for Render</p>
                          </div>
                        )}
                     </div>
                   )}
                </div>
                <div className="p-6 bg-white border-t border-slate-50">
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <span className={`px-2.5 py-1 ${subMode === VideoSubMode.VEO ? 'bg-indigo-50 text-indigo-600' : 'bg-purple-50 text-purple-600'} text-[9px] font-black rounded-lg uppercase tracking-tight`}>{subMode === VideoSubMode.VEO ? 'Veo Auto Magic' : 'One-Click Production'}</span>
                         <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{new Date(task.createTime).toLocaleTimeString()}</span>
                      </div>
                      {task.status === 'completed' && (
                        <button onClick={() => {
                          void logActionSuccess({
                            module: 'video',
                            action: 'download_video',
                            message: '下载短视频结果',
                            meta: {
                              ...baseMeta,
                              taskId: task.id,
                            },
                          });
                          const a = document.createElement('a'); a.href = task.resultUrl!; a.download = `video_export_${task.id}.mp4`; a.click();
                        }} className="text-[10px] font-black text-slate-900 hover:text-purple-600 uppercase flex items-center gap-2 transition-colors">
                          <i className="fas fa-cloud-download-alt text-lg"></i> 保存到本地
                        </button>
                      )}
                   </div>
                </div>
              </div>
            ))}
            {(tasks.length === 0 && !isGenerating && !isAnalyzing) && (
              <div className="col-span-full h-[60vh] flex flex-col items-center justify-center text-center animate-in zoom-in duration-700">
                 <div className="w-32 h-32 bg-white rounded-[48px] shadow-2xl flex items-center justify-center mb-10 border border-slate-100 relative">
                    <i className={`fas ${subMode === VideoSubMode.VEO ? 'fa-bolt' : 'fa-play-circle'} text-5xl ${subMode === VideoSubMode.VEO ? 'text-indigo-500' : 'text-purple-500'}`}></i>
                    <div className={`absolute inset-0 ${subMode === VideoSubMode.VEO ? 'bg-indigo-500/10' : 'bg-purple-500/10'} blur-3xl rounded-full scale-150 -z-10 animate-pulse`}></div>
                 </div>
                 <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">{subMode === VideoSubMode.VEO ? 'Veo 智能导演 · 极速出片' : '短视频一键生成 · 数字化片场'}</h2>
                 <p className="text-slate-500 max-w-sm font-bold text-sm leading-relaxed px-6 italic">{subMode === VideoSubMode.VEO ? '“基于 Google Veo 3.1 引擎，上传图片即可实现极速视频渲染，支持 1080p/720p 自动化创作”' : '“上传一张产品图，豆包 AI 自动导演分镜，Sora 2 引擎提供电影级视觉呈现”'}</p>
              </div>
            )}
            {isAnalyzing && (
              <div className="col-span-full h-[60vh] flex flex-col items-center justify-center text-center">
                 <div className="w-20 h-20 bg-purple-50 rounded-[28px] flex items-center justify-center mb-6 animate-bounce shadow-xl border border-purple-100">
                    <i className="fas fa-brain text-3xl text-purple-600"></i>
                 </div>
                 <h3 className="text-2xl font-black text-slate-800 mb-2">导演正在策划视觉脚本...</h3>
                 <p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">Architecting Narrative & Visual Flow</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default LongVideoSubModule;
