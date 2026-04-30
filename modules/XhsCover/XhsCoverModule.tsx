import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AspectRatio, GlobalApiConfig, XhsCoverFontStyle, XhsCoverPersistentState, XhsCoverProject, XhsCoverTask } from '../../types';
import XhsCoverSidebar from './XhsCoverSidebar';
import { XHS_COVER_STYLES } from './xhsCoverStyles';
import { isRecoverableKieTaskResult, processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { uploadToCos } from '../../services/tencentCosService';
import { normalizeFetchedImageBlob } from '../../utils/imageBlobUtils.mjs';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { logActionFailure, logActionInterrupted, logActionStart, logActionSuccess } from '../../services/loggingService';
import { persistGeneratedAsset } from '../../services/persistedAssetClient';
import { buildXhsCoverPrompt, createXhsCoverBatchRunner } from './xhsCoverUtils.mjs';
import { deleteInternalAssetByUrl } from '../../services/internalApi';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: XhsCoverPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<XhsCoverPersistentState>>;
}

const XhsCoverModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const cancelledTaskIdsRef = useRef<Set<string>>(new Set());
  const recoveryLoopActiveRef = useRef(false);
  const stopSchedulingRef = useRef(false);
  const runTokenRef = useRef(0);

  const updateState = useCallback((updates: Partial<XhsCoverPersistentState>) => {
    onStateChange((prev) => ({ ...prev, ...updates }));
  }, [onStateChange]);

  const FONT_LABEL: Record<XhsCoverFontStyle, string> = {
    variety: '综艺体/粗黑体',
    songti: '宋体/衬线体',
    rounded: '圆体/可爱体',
    handwriting: '手写体/随意体',
    calligraphy: '书法体/毛笔体',
  };

  const createTaskId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  };

  const toSafeAssetBaseName = (value: string) => {
    const normalized = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_');
    return normalized || 'xhs_cover';
  };

  const stopAllInflightWork = useCallback(() => {
    runTokenRef.current += 1;
    stopSchedulingRef.current = true;
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
  }, []);

  const resolveProjectName = useCallback((title: string, createdAt: number) => {
    const safeTitle = String(title || '').trim();
    if (safeTitle) return safeTitle;
    const date = new Date(createdAt);
    return `小红书封面 ${date.toLocaleDateString('zh-CN')}`;
  }, []);

  const buildStateFromProjects = useCallback((
    prev: XhsCoverPersistentState,
    nextProjects: XhsCoverProject[],
    preferredActiveProjectId?: string | null
  ): XhsCoverPersistentState => {
    const nextActiveProjectId = preferredActiveProjectId && nextProjects.some((project) => project.id === preferredActiveProjectId)
      ? preferredActiveProjectId
      : (prev.activeProjectId && nextProjects.some((project) => project.id === prev.activeProjectId) ? prev.activeProjectId : nextProjects[0]?.id || null);
    const activeProject = nextProjects.find((project) => project.id === nextActiveProjectId) || null;
    return {
      ...prev,
      projects: nextProjects,
      activeProjectId: nextActiveProjectId,
      tasks: activeProject?.tasks || [],
    };
  }, []);

  const updateProjects = useCallback((
    updater: (projects: XhsCoverProject[], prev: XhsCoverPersistentState) => { projects: XhsCoverProject[]; activeProjectId?: string | null }
  ) => {
    onStateChange((prev) => {
      const result = updater(prev.projects || [], prev);
      return buildStateFromProjects(prev, result.projects, result.activeProjectId);
    });
  }, [buildStateFromProjects, onStateChange]);

  const updateTask = useCallback((taskId: string, updates: Partial<XhsCoverTask>) => {
    updateProjects((projects, prev) => {
      const activeProjectId = prev.activeProjectId;
      return {
        activeProjectId,
        projects: projects.map((project) => (
          project.id === activeProjectId
            ? {
                ...project,
                updatedAt: Date.now(),
                tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task)),
              }
            : project
        )),
      };
    });
  }, [updateProjects]);

  const persistCoverResult = useCallback(async (sourceUrl: string, styleName: string, signal: AbortSignal) => {
    const response = await fetch(sourceUrl, { signal });
    if (!response.ok) {
      throw new Error(`结果资源拉取失败（${response.status}）`);
    }
    const blob = await normalizeFetchedImageBlob(await response.blob(), sourceUrl);
    return persistGeneratedAsset(blob, 'xhs_cover', `${toSafeAssetBaseName(styleName)}.png`);
  }, []);

  const runSingleTask = useCallback(async (
    task: XhsCoverTask,
    options: {
      mode: 'generate' | 'recover';
      imageUrls?: string[];
      prompt?: string;
      kieAspectRatio?: AspectRatio;
      quality?: XhsCoverPersistentState['quality'];
      model?: XhsCoverPersistentState['model'];
      runToken: number;
    }
  ) => {
    if (options.runToken !== runTokenRef.current || inflightIdsRef.current.has(task.id) || stopSchedulingRef.current) return;

    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    inflightIdsRef.current.add(task.id);

    if (options.runToken === runTokenRef.current) {
      updateTask(task.id, options.mode === 'recover'
        ? { status: 'generating', error: undefined }
        : { status: 'generating', error: undefined, resultUrl: undefined });
    }

    try {
      const result = options.mode === 'recover'
        ? await recoverKieAiTask(String(task.taskId || ''), apiConfig, controller.signal)
        : await processWithKieAi(
          options.imageUrls || [],
          apiConfig,
          {
            targetLanguage: 'zh',
            customLanguage: '',
            removeWatermark: false,
            aspectRatio: options.kieAspectRatio || AspectRatio.P_3_4,
            quality: options.quality || persistentState.quality,
            model: options.model || persistentState.model,
            resolutionMode: 'original',
            targetWidth: 0,
            targetHeight: 0,
            maxFileSize: 2.0,
          },
          false,
          controller.signal,
          options.prompt || ''
        );
      const returnedTaskId = typeof result.taskId === 'string' && result.taskId.trim()
        ? result.taskId
        : undefined;
      if (returnedTaskId && options.runToken === runTokenRef.current) {
        updateTask(task.id, { taskId: returnedTaskId });
      }

      if (controller.signal.aborted || stopSchedulingRef.current || result.status === 'interrupted') {
        throw new Error('INTERRUPTED');
      }
      if (result.status === 'task_not_found') {
        throw new Error('任务已过期或不存在，请重新生成');
      }
      if (result.status !== 'success' || !result.imageUrl) {
        throw new Error(result.message || '任务执行失败');
      }

      const persistedUrl = await persistCoverResult(result.imageUrl, task.styleName || task.styleId, controller.signal);
      if (controller.signal.aborted || stopSchedulingRef.current) {
        throw new Error('INTERRUPTED');
      }

      if (options.runToken === runTokenRef.current) {
        updateTask(task.id, {
          status: 'completed',
          resultUrl: persistedUrl,
          taskId: returnedTaskId || task.taskId,
          error: undefined,
        });
      }
    } catch (err: any) {
      const isManualInterrupt = err?.name === 'AbortError' || err?.message === 'INTERRUPTED';
      if (options.runToken === runTokenRef.current) {
        updateTask(task.id, {
          status: 'error',
          error: isManualInterrupt ? '已手动中断' : (err?.message || '任务执行失败'),
        });
      }
    } finally {
      abortControllersRef.current.delete(controller);
      inflightIdsRef.current.delete(task.id);
    }
  }, [apiConfig, persistCoverResult, persistentState.model, persistentState.quality, updateTask]);

  const activeProject = (persistentState.projects || []).find((project) => project.id === persistentState.activeProjectId) || null;
  const activeTasks = activeProject?.tasks || persistentState.tasks || [];

  useEffect(() => {
    return () => {
      updateProjects((projects, prev) => ({
        activeProjectId: prev.activeProjectId,
        projects: projects.map((project) => ({
          ...project,
          tasks: project.tasks.map((task) => {
            if (cancelledTaskIdsRef.current.has(task.id)) return task;
            if ((task.status === 'generating' || task.status === 'pending') && !task.taskId) {
              return { ...task, status: 'error', error: '页面离开时任务尚未建立可恢复ID，请重新生成' };
            }
            return task;
          }),
        })),
      }));
      onStateChange((prev) => ({ ...prev, isGenerating: false }));
      stopAllInflightWork();
    };
  }, [onStateChange, stopAllInflightWork, updateProjects]);

  useEffect(() => {
    const recoverableTasks = activeTasks.filter((task) =>
      !cancelledTaskIdsRef.current.has(task.id) &&
      task.taskId &&
      (task.status === 'generating' || (task.status === 'error' && isRecoverableKieTaskResult(task.taskId, task.error))) &&
      !inflightIdsRef.current.has(task.id)
    );
    if (recoverableTasks.length === 0 || recoveryLoopActiveRef.current) return;

    const runToken = runTokenRef.current;
    recoveryLoopActiveRef.current = true;
    stopSchedulingRef.current = false;
    onStateChange((prev) => ({ ...prev, isGenerating: true }));
    const runner = createXhsCoverBatchRunner(apiConfig.concurrency);

    void (async () => {
      try {
        await runner(
          recoverableTasks,
          async (task) => {
            await runSingleTask(task, { mode: 'recover', runToken });
          },
          { shouldContinue: () => runToken === runTokenRef.current && !stopSchedulingRef.current }
        );
      } finally {
        recoveryLoopActiveRef.current = false;
        if (runToken === runTokenRef.current) {
          onStateChange((prev) => {
            if (inflightIdsRef.current.size > 0) return prev;
            const hasGeneratingTask = prev.projects.some((project) => project.tasks.some((task) => task.status === 'generating'));
            return hasGeneratingTask ? prev : { ...prev, isGenerating: false };
          });
        }
      }
    })();
  }, [activeTasks, apiConfig.concurrency, onStateChange, runSingleTask]);

  const handleStart = async () => {
    const { productImages, uploadedProductUrls, title, subtitle, selectedStyleIds, fontStyle, aspectRatio, quality, model, decoration, extraRequirement } = persistentState;
    if (!title.trim()) return;
    if (selectedStyleIds.length === 0) return;
    if (productImages.length === 0 && (uploadedProductUrls?.length ?? 0) === 0) return;

    stopAllInflightWork();
    cancelledTaskIdsRef.current.clear();
    const runToken = runTokenRef.current;

    const initialTasks: XhsCoverTask[] = selectedStyleIds.map((id) => {
      const style = XHS_COVER_STYLES.find((s) => s.id === id);
      return {
        id: createTaskId(),
        styleId: id,
        styleName: style?.name || id,
        status: 'pending',
      };
    });
    const createdAt = Date.now();
    const projectId = createTaskId();
    const nextProject: XhsCoverProject = {
      id: projectId,
      name: resolveProjectName(title, createdAt),
      title: title.trim(),
      subtitle: subtitle.trim(),
      aspectRatio,
      fontStyle,
      decoration: decoration.trim(),
      extraRequirement: extraRequirement.trim(),
      createdAt,
      updatedAt: createdAt,
      tasks: initialTasks,
    };
    onStateChange((prev) => ({
      ...buildStateFromProjects(prev, [nextProject, ...(prev.projects || [])], projectId),
      isGenerating: true,
    }));
    stopSchedulingRef.current = false;

    void logActionStart({ module: 'xhs_cover', action: 'generate', message: `开始生成小红书封面，${selectedStyleIds.length} 种风格` });

    let imageUrls: string[] = [];
    try {
      if (productImages.length > 0) {
        imageUrls = [];
        for (const image of productImages) {
          if (runToken !== runTokenRef.current || stopSchedulingRef.current) {
            return;
          }
          imageUrls.push(await uploadToCos(image, apiConfig));
        }
        if (runToken !== runTokenRef.current || stopSchedulingRef.current) {
          return;
        }
        onStateChange((prev) => ({ ...prev, uploadedProductUrls: imageUrls }));
      } else {
        imageUrls = uploadedProductUrls || [];
      }
    } catch (err: any) {
      void logActionFailure({ module: 'xhs_cover', action: 'generate', message: '小红书封面素材上传失败', detail: err?.message || '' });
      if (runToken === runTokenRef.current) {
        updateProjects((projects, prev) => ({
          activeProjectId: prev.activeProjectId,
          projects: projects.map((project) => (
            project.id === prev.activeProjectId
              ? {
                  ...project,
                  updatedAt: Date.now(),
                  tasks: project.tasks.map((task) => ({ ...task, status: 'error', error: '图片上传失败: ' + err.message })),
                }
              : project
          )),
        }));
        onStateChange((prev) => ({ ...prev, isGenerating: false }));
      }
      return;
    }

    if (runToken !== runTokenRef.current || stopSchedulingRef.current) {
      if (runToken === runTokenRef.current) {
        onStateChange((prev) => ({ ...prev, isGenerating: false }));
      }
      return;
    }

    const aspectRatioMap: Record<XhsCoverPersistentState['aspectRatio'], AspectRatio> = {
      '3:4': AspectRatio.P_3_4,
      '1:1': AspectRatio.SQUARE,
      '9:16': AspectRatio.P_9_16,
    };
    const kieAspectRatio = aspectRatioMap[aspectRatio] || AspectRatio.P_3_4;
    const runner = createXhsCoverBatchRunner(apiConfig.concurrency);

    await runner(
      initialTasks,
      async (task) => {
        if (runToken !== runTokenRef.current || stopSchedulingRef.current) return;
        const style = XHS_COVER_STYLES.find((s) => s.id === task.styleId);
        if (!style) {
          updateTask(task.id, { status: 'error', error: '风格模板缺失' });
          return;
        }
        const prompt = buildXhsCoverPrompt({
          stylePrompt: style.prompt,
          title,
          subtitle,
          fontLabel: FONT_LABEL[fontStyle],
          decoration,
          extraRequirement,
        });
        await runSingleTask(task, { mode: 'generate', imageUrls, prompt, kieAspectRatio, quality, model, runToken });
      },
      { shouldContinue: () => runToken === runTokenRef.current && !stopSchedulingRef.current }
    );

    if (runToken !== runTokenRef.current) return;
    onStateChange((prev) => ({ ...prev, isGenerating: false }));
    if (stopSchedulingRef.current) {
      void logActionInterrupted({ module: 'xhs_cover', action: 'generate', message: '小红书封面生成已中断' });
      return;
    }
    void logActionSuccess({ module: 'xhs_cover', action: 'generate', message: '小红书封面生成完成' });
  };

  const handleCancel = () => {
    const cancelledIds = activeTasks
      .filter((task) => task.status === 'generating' || task.status === 'pending')
      .map((task) => task.id);
    cancelledIds.forEach((taskId) => cancelledTaskIdsRef.current.add(taskId));
    stopAllInflightWork();
    updateProjects((projects, prev) => ({
      activeProjectId: prev.activeProjectId,
      projects: projects.map((project) => (
        project.id === prev.activeProjectId
          ? {
              ...project,
              updatedAt: Date.now(),
              tasks: project.tasks.map((task) =>
                (task.status === 'generating' || task.status === 'pending') ? { ...task, status: 'error', error: '已手动中断' } : task
              ),
            }
          : project
      )),
    }));
    onStateChange((prev) => ({ ...prev, isGenerating: false }));
    void logActionInterrupted({ module: 'xhs_cover', action: 'generate', message: '手动中断小红书封面生成' });
  };

  const deleteProjectAssets = useCallback(async (project: XhsCoverProject) => {
    const resultUrls = project.tasks
      .map((task) => task.resultUrl)
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    await Promise.all(resultUrls.map((url) => deleteInternalAssetByUrl(url)));
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const targetProject = (persistentState.projects || []).find((project) => project.id === projectId);
    if (!targetProject) return;
    if (!window.confirm(`确认删除项目「${targetProject.name}」吗？已生成图片也会一并删除。`)) return;

    if (projectId === persistentState.activeProjectId) {
      stopAllInflightWork();
      setPreviewUrl(null);
      onStateChange((prev) => ({ ...prev, isGenerating: false }));
    }

    try {
      await deleteProjectAssets(targetProject);
      updateProjects((projects) => ({
        projects: projects.filter((project) => project.id !== projectId),
      }));
      void logActionSuccess({ module: 'xhs_cover', action: 'delete_project', message: '删除小红书封面项目', meta: { projectId } });
    } catch (error: any) {
      void logActionFailure({ module: 'xhs_cover', action: 'delete_project', message: '删除小红书封面项目失败', detail: error?.message || '', meta: { projectId } });
      alert(error?.message || '删除项目失败');
    }
  }, [deleteProjectAssets, onStateChange, persistentState.activeProjectId, persistentState.projects, stopAllInflightWork, updateProjects]);

  const handleClearProjects = useCallback(async () => {
    const projects = persistentState.projects || [];
    if (projects.length === 0) return;
    if (!window.confirm(`确认清空全部 ${projects.length} 个项目吗？已生成图片也会一并删除。`)) return;

    stopAllInflightWork();
    setPreviewUrl(null);
    onStateChange((prev) => ({ ...prev, isGenerating: false }));

    try {
      await Promise.all(projects.map((project) => deleteProjectAssets(project)));
      updateProjects(() => ({ projects: [], activeProjectId: null }));
      void logActionSuccess({ module: 'xhs_cover', action: 'clear_all_projects', message: '清空小红书封面项目', meta: { projectCount: projects.length } });
    } catch (error: any) {
      void logActionFailure({ module: 'xhs_cover', action: 'clear_all_projects', message: '清空小红书封面项目失败', detail: error?.message || '', meta: { projectCount: projects.length } });
      alert(error?.message || '清空项目失败');
    }
  }, [deleteProjectAssets, onStateChange, persistentState.projects, stopAllInflightWork, updateProjects]);

  const handleDownload = async (task: XhsCoverTask) => {
    if (!task.resultUrl) return;
    try {
      const resp = await fetch(task.resultUrl);
      const blob = await resp.blob();
      const url = safeCreateObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xhs_cover_${task.styleName}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('下载失败');
    }
  };

  const { isGenerating } = persistentState;
  const projects = persistentState.projects || [];
  const tasks = activeTasks;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="flex h-full overflow-hidden">
      <XhsCoverSidebar
        state={persistentState}
        onUpdate={updateState}
        onStart={handleStart}
        isProcessing={isGenerating}
        apiConfig={apiConfig}
      />

      <main className="flex-1 overflow-y-auto p-8 bg-slate-50 scrollbar-hide">
        <div className="max-w-6xl mx-auto">
          {projects.length > 0 && (
            <div className="mb-6 rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {projects.map((project) => {
                    const isActive = project.id === persistentState.activeProjectId;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => updateProjects((currentProjects) => ({ projects: currentProjects, activeProjectId: project.id }))}
                        className={`shrink-0 rounded-xl border px-4 py-2 text-left transition-all ${
                          isActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span className="block text-[11px] font-black">{project.name}</span>
                        <span className="block text-[10px] opacity-70">{project.tasks.filter((task) => task.status === 'completed').length}/{project.tasks.length}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => void handleClearProjects()}
                  className="shrink-0 rounded-xl border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-500 hover:bg-rose-50"
                >
                  清空项目
                </button>
              </div>
            </div>
          )}

          {/* 顶部工具栏 */}
          {tasks.length > 0 && (
            <div className="flex items-center justify-between bg-white px-6 py-4 rounded-[28px] border border-slate-100 shadow-xl mb-8 sticky top-0 z-20 backdrop-blur-md bg-white/90">
              <div>
                <span className="text-sm font-bold text-slate-600">
                  已完成 <span className="text-rose-500">{completedCount}</span> / {tasks.length} 张
                </span>
                {activeProject && (
                  <p className="mt-1 text-[11px] font-medium text-slate-400">{activeProject.name}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeProject && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteProject(activeProject.id)}
                    className="px-4 py-2 bg-slate-100 text-slate-600 font-semibold text-xs rounded-xl hover:bg-slate-200 transition-all"
                  >
                    删除项目
                  </button>
                )}
                {isGenerating && (
                  <button
                    onClick={handleCancel}
                    className="px-5 py-2 bg-rose-600 text-white font-semibold text-xs rounded-xl hover:bg-rose-700 shadow-xl shadow-rose-100 transition-all flex items-center gap-2"
                  >
                    <i className="fas fa-stop" /> 中断生成
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 结果网格 */}
          {tasks.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`bg-white rounded-3xl border overflow-hidden flex flex-col transition-all duration-300 ${
                    task.status === 'completed' ? 'border-slate-200 shadow-lg' : 'border-slate-100 border-dashed'
                  }`}
                >
                  <div
                    className="relative overflow-hidden cursor-pointer"
                    style={{ aspectRatio: persistentState.aspectRatio === '9:16' ? '9/16' : persistentState.aspectRatio === '1:1' ? '1/1' : '3/4' }}
                    onClick={() => task.resultUrl && setPreviewUrl(task.resultUrl)}
                  >
                    {task.status === 'completed' && task.resultUrl ? (
                      <div className="relative w-full h-full group">
                        <img src={task.resultUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" alt={task.styleName} />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); setPreviewUrl(task.resultUrl!); }} className="px-3 py-1.5 bg-white/20 hover:bg-white text-white hover:text-slate-900 backdrop-blur-md rounded-full text-[10px] font-bold transition-all">
                            <i className="fas fa-eye mr-1" /> 预览
                          </button>
                        </div>
                      </div>
                    ) : task.status === 'generating' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50">
                        <div className="w-8 h-8 border-4 border-rose-100 border-t-rose-500 rounded-full animate-spin mb-2" />
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest animate-pulse">Rendering...</p>
                      </div>
                    ) : task.status === 'error' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-3 text-center">
                        <i className="fas fa-exclamation-triangle text-rose-400 text-xl mb-1" />
                        <p className="text-[9px] font-bold text-rose-500">生成失败</p>
                        <p className="text-[8px] text-slate-400 mt-1 line-clamp-2">{task.error}</p>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-50 opacity-30">
                        <i className="fas fa-image text-2xl text-slate-300" />
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-600 truncate">{task.styleName}</span>
                    {task.status === 'completed' && (
                      <button
                        onClick={() => handleDownload(task)}
                        className="ml-2 shrink-0 w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-rose-500 hover:text-white text-slate-500 rounded-lg transition-all text-[10px]"
                      >
                        <i className="fas fa-download" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center">
              <div className="w-32 h-32 bg-white rounded-[48px] shadow-2xl flex items-center justify-center mb-10 border border-slate-100 relative group overflow-hidden">
                <i className="fas fa-book-open text-5xl text-rose-500 relative z-10" />
                <div className="absolute inset-0 bg-rose-500/10 blur-3xl rounded-full scale-150 -z-10 group-hover:scale-125 transition-transform duration-1000" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-700 tracking-tight">小红书封面生成器</h2>
              <p className="mt-2 text-sm text-slate-400">上传图片，填写标题，选择风格，一键生成</p>
            </div>
          )}
        </div>
      </main>

      {previewUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain"
            onClick={(e) => e.stopPropagation()}
            alt="preview"
          />
        </div>
      )}
    </div>
  );
};

export default XhsCoverModule;
