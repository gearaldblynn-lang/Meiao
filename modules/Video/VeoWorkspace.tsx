
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { VeoProjectState, VeoVariant, GlobalApiConfig, VeoScriptSegment } from '../../types';
import { submitVeoVideoTask, pollVeoTaskStatus } from '../../services/kieAiService';
import { createZipAndDownload } from '../../utils/imageUtils';
import { useToast } from '../../components/ToastSystem';

interface Props {
  apiConfig: GlobalApiConfig;
  projects: VeoProjectState[];
  referenceImages: string[];
  aspectRatio: '16:9' | '9:16';
  onProjectsChange: (projects: VeoProjectState[]) => void;
  onBack: () => void;
}

const VeoWorkspace: React.FC<Props> = ({ 
  apiConfig, projects, referenceImages, aspectRatio, onProjectsChange 
}) => {
  const { addToast } = useToast();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set(projects.length > 0 ? [projects[0].id] : []));
  const [activeSegmentIndices, setActiveSegmentIndices] = useState<Record<string, number>>({});
  const [isPackaging, setIsPackaging] = useState(false);
  const [runningProjectIds, setRunningProjectIds] = useState<Set<string>>(new Set());
  const [localProcessingIds, setLocalProcessingIds] = useState<Set<string>>(new Set());
  const [autoGeneratingIds, setAutoGeneratingIds] = useState<Set<string>>(new Set());

  // --- Dynamic Layout Calculation ---
  const [containerHeight, setContainerHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout Constraints
  const MIN_SIDEBAR_LEFT = 220; 
  const MIN_SIDEBAR_RIGHT = 300; 
  
  // Calculate minimum width required to display everything without crushing
  const currentRatio = aspectRatio === '16:9' ? 16/9 : 9/16;
  const currentVideoWidth = containerHeight * currentRatio;
  // Add a little buffer (e.g. 2px) for borders
  const minRequiredWidth = MIN_SIDEBAR_LEFT + MIN_SIDEBAR_RIGHT + currentVideoWidth + 2;

  useLayoutEffect(() => {
    const handleResize = () => {
        const PADDING_X = 80; // Approximate outer padding/margins
        const MAX_HEIGHT = 700; // Cap height for large screens
        const MIN_HEIGHT = 420; // Minimum viable height for the editor

        const ratioVal = aspectRatio === '16:9' ? 16/9 : 9/16;
        const screenW = window.innerWidth;
        
        // 1. Calculate how much width is available for the video player
        const maxAvailableVideoW = screenW - MIN_SIDEBAR_LEFT - MIN_SIDEBAR_RIGHT - PADDING_X;
        
        // 2. Derive the maximum possible height based on that width constraint
        // Height = Width / Ratio
        const heightConstrainedByWidth = maxAvailableVideoW / ratioVal;
        
        // 3. The final height is the smaller of:
        //    a) The height allowed by the screen width
        //    b) The max comfortable height (MAX_HEIGHT)
        //    But at least MIN_HEIGHT.
        const optimalHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, heightConstrainedByWidth));
        
        setContainerHeight(Math.floor(optimalHeight));
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial calc
    return () => window.removeEventListener('resize', handleResize);
  }, [aspectRatio]);
  // ----------------------------------

  // Effect to handle auto-generation sequence
  useEffect(() => {
    if (autoGeneratingIds.size === 0) return;

    autoGeneratingIds.forEach(projectId => {
      const project = projects.find(p => p.id === projectId);
      if (!project) {
        setAutoGeneratingIds(prev => { const n = new Set(prev); n.delete(projectId); return n; });
        return;
      }

      const nextIndex = project.states.findIndex(s => s.status !== 'COMPLETED');
      
      if (nextIndex === -1) {
        setAutoGeneratingIds(prev => { const n = new Set(prev); n.delete(projectId); return n; });
        addToast(`项目 "${project.name}" 全部生成完毕！`, 'success');
        return;
      }

      const segment = project.states[nextIndex];

      if (segment.status === 'GENERATING' || localProcessingIds.has(segment.segmentId)) return;

      if (segment.status === 'FAILED') {
         setAutoGeneratingIds(prev => { const n = new Set(prev); n.delete(projectId); return n; });
         setActiveSegment(projectId, nextIndex);
         return;
      }

      if (nextIndex > 0) {
        const prev = project.states[nextIndex - 1];
        if (prev.status !== 'COMPLETED' || !prev.selectedVariantId) {
            setAutoGeneratingIds(prev => { const n = new Set(prev); n.delete(projectId); return n; });
            addToast(`自动生成中断：分镜 ${nextIndex + 1} 依赖的前序分镜未就绪`, 'warning');
            return;
        }
      }

      executeSegmentGeneration(projectId, nextIndex);
    });
  }, [projects, autoGeneratingIds, localProcessingIds]);

  const toggleProjectExpand = (projectId: string) => {
    const newSet = new Set(expandedProjectIds);
    if (newSet.has(projectId)) {
      newSet.delete(projectId);
    } else {
      newSet.add(projectId);
    }
    setExpandedProjectIds(newSet);
  };

  const setActiveSegment = (projectId: string, index: number) => {
    setActiveSegmentIndices(prev => ({ ...prev, [projectId]: index }));
  };

  const updateProjectState = (projectId: string, updates: Partial<VeoProjectState> | ((p: VeoProjectState) => VeoProjectState)) => {
    onProjectsChange(projects.map(p => {
      if (p.id === projectId) {
        if (typeof updates === 'function') return updates(p);
        return { ...p, ...updates };
      }
      return p;
    }));
  };

  const updateScriptContent = (projectId: string, segmentId: string, field: keyof VeoScriptSegment, value: string) => {
    updateProjectState(projectId, p => ({
      ...p,
      states: p.states.map(s => s.segmentId === segmentId ? {
        ...s,
        script: { ...s.script, [field]: value }
      } : s)
    }));
  };

  const executeSegmentGeneration = async (projectId: string, segmentIndex: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const state = project.states[segmentIndex];
    
    if (localProcessingIds.has(state.segmentId) || state.status === 'GENERATING') return;

    const prevSegment = segmentIndex > 0 ? project.states[segmentIndex - 1] : null;

    if (segmentIndex > 0 && (!prevSegment || !prevSegment.selectedVariantId)) {
      addToast("无法生成：上一分镜尚未完成。Veo 需要连续的视频流作为参考。", 'warning');
      return;
    }

    setLocalProcessingIds(prev => new Set(prev).add(state.segmentId));

    updateProjectState(projectId, p => ({
      ...p,
      states: p.states.map((s, i) => i === segmentIndex ? { ...s, status: 'GENERATING', errorMsg: undefined } : s)
    }));
    
    setActiveSegment(projectId, segmentIndex);
    setRunningProjectIds(prev => new Set(prev).add(projectId));

    try {
      const selectedPrevVariant = prevSegment?.variants.find(v => v.id === prevSegment.selectedVariantId);
      
      const taskId = await submitVeoVideoTask(
        { description: state.script.description, spokenContent: state.script.spokenContent, bgm: state.script.bgm },
        aspectRatio,
        segmentIndex === 0 ? referenceImages : [],
        selectedPrevVariant?.taskId,
        apiConfig,
        new AbortController().signal 
      );

      updateProjectState(projectId, p => ({
        ...p,
        states: p.states.map((s, i) => i === segmentIndex ? { ...s, lastTaskId: taskId } : s)
      }));

      const videoUrl = await pollVeoTaskStatus(taskId, apiConfig, new AbortController().signal);

      const newVariant: VeoVariant = {
        id: `var-${Date.now()}`,
        taskId,
        uri: videoUrl,
        blobUrl: videoUrl,
        createdAt: Date.now(),
        schemeName: `方案 ${state.variants.length + 1}`
      };

      updateProjectState(projectId, p => ({
        ...p,
        states: p.states.map((s, i) => i === segmentIndex ? { 
          ...s, 
          status: 'COMPLETED', 
          variants: [...s.variants, newVariant], 
          selectedVariantId: newVariant.id 
        } : s)
      }));
      
      addToast(`分镜 ${segmentIndex + 1} 生成成功！`, 'success');

    } catch (error: any) {
      const errMsg = error.message || "未知错误";
      addToast(`生成任务失败: ${errMsg}`, 'error');
      updateProjectState(projectId, p => ({
        ...p,
        states: p.states.map((s, i) => i === segmentIndex ? { ...s, status: 'FAILED', errorMsg: errMsg } : s)
      }));
    } finally {
      setLocalProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(state.segmentId);
        return next;
      });
      setRunningProjectIds(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  const handleRetrieveResult = async (projectId: string, segmentIndex: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const state = project.states[segmentIndex];
    if (!state.lastTaskId) return;

    if (localProcessingIds.has(state.segmentId)) return;
    setLocalProcessingIds(prev => new Set(prev).add(state.segmentId));

    updateProjectState(projectId, p => ({
      ...p,
      states: p.states.map((s, i) => i === segmentIndex ? { ...s, status: 'GENERATING', errorMsg: undefined } : s)
    }));

    try {
      const videoUrl = await pollVeoTaskStatus(state.lastTaskId, apiConfig, new AbortController().signal);
      
      const newVariant: VeoVariant = {
        id: `var-${Date.now()}-recovered`,
        taskId: state.lastTaskId,
        uri: videoUrl,
        blobUrl: videoUrl,
        createdAt: Date.now(),
        schemeName: `找回方案`
      };

      updateProjectState(projectId, p => ({
        ...p,
        states: p.states.map((s, i) => i === segmentIndex ? { 
          ...s, 
          status: 'COMPLETED', 
          variants: [...s.variants, newVariant], 
          selectedVariantId: newVariant.id 
        } : s)
      }));
      addToast("成功找回云端结果", 'success');
    } catch (error: any) {
      const errMsg = error.message || "找回失败";
      addToast(`找回结果失败: ${errMsg}`, 'error');
      updateProjectState(projectId, p => ({
        ...p,
        states: p.states.map((s, i) => i === segmentIndex ? { ...s, status: 'FAILED', errorMsg: errMsg } : s)
      }));
    } finally {
      setLocalProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(state.segmentId);
        return next;
      });
    }
  };

  const handleSmartGenerateProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const nextIndex = project.states.findIndex(s => s.status !== 'COMPLETED');
    
    if (nextIndex === -1) {
      addToast("该项目所有分镜已生成完毕！", 'info');
      return;
    }

    if (nextIndex > 0) {
      const prev = project.states[nextIndex - 1];
      if (prev.status !== 'COMPLETED' || !prev.selectedVariantId) {
        addToast(`无法跳跃生成：请先完成第 ${nextIndex} 个分镜。`, 'warning');
        setActiveSegment(projectId, nextIndex - 1);
        return;
      }
    }

    addToast("已启动全案自动生成队列...", 'info');
    setAutoGeneratingIds(prev => new Set(prev).add(projectId));
  };

  const handleGenerateAllProjects = () => {
    const ids = projects.filter(p => p.states.some(s => s.status !== 'COMPLETED')).map(p => p.id);
    if (ids.length === 0) {
        addToast("所有项目均已完成！", 'success');
        return;
    }
    addToast(`已启动 ${ids.length} 个项目的自动生成任务`, 'info');
    setAutoGeneratingIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
    });
  };

  const handleDownloadProject = async (project: VeoProjectState) => {
    const completed = project.states.filter(s => s.status === 'COMPLETED' && s.selectedVariantId);
    if (completed.length === 0) return;
    
    setIsPackaging(true);
    addToast("开始打包下载...", 'info');
    try {
      const files = await Promise.all(completed.map(async (s, i) => {
        const v = s.variants.find(v => v.id === s.selectedVariantId);
        const resp = await fetch(v!.blobUrl);
        const blob = await resp.blob();
        return { blob, path: `segment_${i + 1}.mp4` };
      }));
      await createZipAndDownload(files, `Veo_Project_${project.name}_${Date.now()}`);
      addToast("下载成功！", 'success');
    } catch (e) {
      addToast("打包下载失败", 'error');
    } finally {
      setIsPackaging(false);
    }
  };

  const handleSingleSegmentDownload = async (url: string, filename: string) => {
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        addToast("开始下载分镜...", 'success');
    } catch (e: any) {
        console.error("Download failed", e);
        addToast(`下载失败: ${e.message || "网络错误"}`, 'error');
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-50 overflow-hidden" ref={containerRef}>
      <div className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600"><i className="fas fa-video"></i></div>
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Veo 智慧工作台</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">MULTI-PROJECT MANAGEMENT</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleGenerateAllProjects}
            className="px-6 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 flex items-center gap-2"
          >
            <i className="fas fa-play"></i> 一键生成所有项目
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        {projects.map((project) => {
          const completedCount = project.states.filter(s => s.status === 'COMPLETED').length;
          const totalCount = project.states.length;
          const progress = (completedCount / totalCount) * 100;
          const isExpanded = expandedProjectIds.has(project.id);
          const isRunning = runningProjectIds.has(project.id);
          const isAutoRunning = autoGeneratingIds.has(project.id);
          
          const activeIndex = activeSegmentIndices[project.id] || 0;
          const activeSegment = project.states[activeIndex];

          return (
            <div key={project.id} className={`bg-white rounded-[32px] border transition-all duration-300 overflow-hidden ${isExpanded ? 'border-indigo-200 shadow-xl ring-1 ring-indigo-50' : 'border-slate-100 shadow-sm hover:border-indigo-100'}`}>
              <div 
                className="px-8 py-5 flex items-center justify-between bg-white cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => toggleProjectExpand(project.id)}
              >
                <div className="flex items-center gap-6 flex-1">
                  <div className="flex flex-col gap-1 w-64">
                    <h3 className="text-base font-black text-slate-800">{project.name}</h3>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{completedCount} / {totalCount} 分镜完成</span>
                    {isRunning && <span className="text-[10px] font-black text-indigo-500 animate-pulse"><i className="fas fa-circle-notch fa-spin mr-1"></i>生成中...</span>}
                    {isAutoRunning && <span className="text-[10px] font-black text-rose-500 animate-pulse"><i className="fas fa-bolt mr-1"></i>自动生成队列中</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {completedCount > 0 && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDownloadProject(project); }}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-slate-50 hover:text-indigo-600 transition-all"
                    >
                      {isPackaging ? '打包中...' : '下载'}
                    </button>
                  )}
                  <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        if (isAutoRunning) {
                            setAutoGeneratingIds(prev => { const n = new Set(prev); n.delete(project.id); return n; });
                            addToast("已停止自动生成", 'info');
                        } else {
                            handleSmartGenerateProject(project.id); 
                        }
                    }}
                    disabled={(!isAutoRunning && isRunning) || completedCount === totalCount}
                    className={`px-5 py-2 text-white text-[10px] font-bold rounded-lg transition-all flex items-center gap-2 ${
                        isAutoRunning 
                        ? 'bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-100' 
                        : 'bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400'
                    }`}
                  >
                    {isAutoRunning ? <><i className="fas fa-stop"></i> 停止自动生成</> : (completedCount === totalCount ? '已完成' : <><i className="fas fa-bolt"></i> 生成该项目</>)}
                  </button>
                  <i className={`fas fa-chevron-down text-slate-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}></i>
                </div>
              </div>

              {isExpanded && (
                <div 
                  className="border-t border-slate-100 transition-all duration-500 ease-in-out overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent"
                  style={{ height: `${containerHeight}px` }}
                >
                  {/* The Integrated Workspace: No padding, full width but honors min-width */}
                  <div 
                    className="flex h-full bg-white w-full"
                    style={{ minWidth: `${minRequiredWidth}px` }}
                  >
                    
                    {/* Left: Segment List - Flexible Width */}
                    <div className="flex-1 min-w-[220px] max-w-[280px] border-r border-slate-100 flex flex-col shrink-0 bg-slate-50/30">
                      <div className="p-4 border-b border-slate-100 bg-white">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">分镜 SEQUENCE</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {project.states.map((state, idx) => (
                          <div 
                            key={state.segmentId}
                            onClick={() => setActiveSegment(project.id, idx)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer group ${idx === activeIndex ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-50' : 'bg-transparent border-transparent hover:bg-white hover:border-slate-100'}`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                state.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-600' : 
                                state.status === 'GENERATING' ? 'bg-indigo-100 text-indigo-600' : 
                                state.status === 'FAILED' ? 'bg-rose-100 text-rose-600' : 
                                'bg-slate-200 text-slate-500'
                              }`}>
                                S{idx + 1}
                              </span>
                              <span className="text-[9px] font-bold text-slate-300">{state.script.duration}s</span>
                            </div>
                            <p className={`text-[10px] line-clamp-2 leading-relaxed ${idx === activeIndex ? 'text-slate-700 font-bold' : 'text-slate-500'}`}>
                              {state.script.title}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Middle: Video Player - Fixed Aspect Ratio, Flex None */}
                    <div 
                        className="relative flex-none bg-slate-100 group/video flex flex-col items-center justify-center border-r border-slate-100"
                        style={{ aspectRatio: aspectRatio === '16:9' ? '16/9' : '9/16' }}
                    >
                        {/* Real Content Layer */}
                        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                            {/* Light Grid Background Pattern */}
                            <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

                            {activeSegment.status === 'GENERATING' ? (
                                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                                    <div className="relative w-16 h-16 mb-4">
                                        <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                                        <div className="absolute inset-0 border-4 border-t-indigo-500 border-r-indigo-500/30 border-b-transparent border-l-transparent rounded-full animate-spin"></div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <i className="fas fa-video text-indigo-500 animate-pulse text-lg"></i>
                                        </div>
                                    </div>
                                    <h3 className="text-slate-800 font-black text-sm mb-1 tracking-tight">AI 视频渲染中</h3>
                                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Generating Scene {activeIndex + 1}...</p>
                                </div>
                            ) : activeSegment.status === 'FAILED' ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 z-10 bg-white/90 backdrop-blur">
                                    <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mb-3 animate-in zoom-in duration-300 border border-rose-100">
                                        <i className="fas fa-exclamation-triangle text-rose-500 text-lg"></i>
                                    </div>
                                    <p className="text-xs font-black text-rose-500 uppercase mb-1 tracking-widest">生成失败</p>
                                    
                                    <div className="bg-white border border-rose-100 rounded-xl p-3 w-full max-w-[200px] mb-4 text-left overflow-y-auto max-h-24 scrollbar-thin scrollbar-thumb-rose-200 shadow-sm">
                                        <p className="text-[9px] text-rose-400 font-medium leading-relaxed break-words">
                                            {activeSegment.errorMsg || 'Unknown error occurred during video rendering.'}
                                        </p>
                                    </div>

                                    <div className="flex flex-col gap-2 w-full max-w-[160px]">
                                        {activeSegment.lastTaskId && (
                                        <button 
                                            onClick={() => handleRetrieveResult(project.id, activeIndex)}
                                            className="px-4 py-2 bg-indigo-600 text-white text-[9px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
                                        >
                                            <i className="fas fa-search mr-2"></i> 尝试找回
                                        </button>
                                        )}
                                        <button 
                                        onClick={() => executeSegmentGeneration(project.id, activeIndex)}
                                        className="px-4 py-2 bg-slate-100 text-slate-600 text-[9px] font-bold rounded-lg hover:bg-slate-200 transition-all border border-slate-200 active:scale-95"
                                        >
                                        <i className="fas fa-redo mr-2"></i> 重新生成
                                        </button>
                                    </div>
                                </div>
                            ) : activeSegment.status === 'COMPLETED' ? (
                                <>
                                    <video 
                                        key={activeSegment.variants.find(v => v.id === activeSegment.selectedVariantId)?.blobUrl}
                                        src={activeSegment.variants.find(v => v.id === activeSegment.selectedVariantId)?.blobUrl} 
                                        className="w-full h-full object-contain shadow-sm bg-black" 
                                        controls 
                                        autoPlay={false}
                                        loop={false}
                                        playsInline
                                        onError={(e) => {
                                          const target = e.target as HTMLVideoElement;
                                          const videoUrl = activeSegment.variants.find(v => v.id === activeSegment.selectedVariantId)?.blobUrl;
                                          if (videoUrl?.startsWith('blob:')) {
                                            target.style.display = 'none';
                                            const parent = target.parentElement;
                                            if (parent) {
                                              const placeholder = document.createElement('div');
                                              placeholder.className = "absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-400 p-8 text-center";
                                              placeholder.innerHTML = `
                                                <i class="fas fa-video-slash text-3xl mb-3"></i>
                                                <p class="text-xs font-black uppercase tracking-widest">视频预览已失效</p>
                                                <p class="text-[10px] mt-2 opacity-60">Blob URL 已过期，请重新生成或从云端找回</p>
                                              `;
                                              parent.appendChild(placeholder);
                                            }
                                          }
                                        }}
                                    />
                                    <div className="absolute top-4 right-4 opacity-0 group-hover/video:opacity-100 transition-opacity duration-300 z-20">
                                        <button 
                                            onClick={() => handleSingleSegmentDownload(activeSegment.variants.find(v => v.id === activeSegment.selectedVariantId)?.blobUrl!, `veo_segment_${activeIndex+1}.mp4`)}
                                            className="w-8 h-8 bg-black/50 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-white hover:text-black transition-all shadow-lg border border-white/10"
                                            title="下载此分镜"
                                        >
                                            <i className="fas fa-download text-xs"></i>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                                        <i className="fas fa-film text-3xl text-slate-300"></i>
                                    </div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Waiting for Render</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Script Editor - Flexible Width */}
                    <div className="flex-[1.5] min-w-[300px] flex flex-col shrink-0 bg-white">
                      <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Action Header */}
                        <div className="flex items-center justify-between pb-4 border-b border-slate-50">
                          <div>
                              <h4 className="text-sm font-black text-slate-800">Scene {activeIndex + 1}</h4>
                              <p className="text-[10px] text-slate-400 font-bold truncate max-w-[120px]">{activeSegment.script.title}</p>
                          </div>
                          <button 
                             onClick={() => executeSegmentGeneration(project.id, activeIndex)}
                             disabled={activeSegment.status === 'GENERATING' || localProcessingIds.has(activeSegment.segmentId)}
                             className="px-4 py-2 bg-indigo-600 text-white font-black text-[10px] rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-200 transition-all active:scale-95 flex items-center gap-2"
                           >
                             {(activeSegment.status === 'GENERATING' || localProcessingIds.has(activeSegment.segmentId)) ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-bolt"></i>}
                             {(activeSegment.status === 'GENERATING' || localProcessingIds.has(activeSegment.segmentId)) ? '渲染中' : '生成分镜'}
                           </button>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <i className="fas fa-eye text-indigo-400"></i> 视觉画面描述
                          </label>
                          <textarea 
                            value={activeSegment.script.description}
                            onChange={(e) => updateScriptContent(project.id, activeSegment.segmentId, 'description', e.target.value)}
                            disabled={activeSegment.status === 'GENERATING' || localProcessingIds.has(activeSegment.segmentId)}
                            className="w-full h-32 bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-medium text-slate-600 resize-none outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all leading-relaxed"
                            placeholder="描述画面的主体、动作、运镜和光影..."
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <i className="fas fa-microphone-alt text-rose-400"></i> 人声口播文案
                          </label>
                          <textarea 
                            value={activeSegment.script.spokenContent}
                            onChange={(e) => updateScriptContent(project.id, activeSegment.segmentId, 'spokenContent', e.target.value)}
                            disabled={activeSegment.status === 'GENERATING' || localProcessingIds.has(activeSegment.segmentId)}
                            className="w-full h-32 bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-medium text-slate-600 resize-none outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all leading-relaxed"
                            placeholder="输入口播内容..."
                          />
                        </div>

                        <div className="pt-4 border-t border-slate-50">
                           <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-2">
                              <span>参考背景音乐</span>
                              <span className="text-slate-300 italic">{activeSegment.script.bgm}</span>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VeoWorkspace;
