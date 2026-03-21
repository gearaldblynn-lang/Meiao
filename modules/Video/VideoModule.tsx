import React from 'react';
import {
  GlobalApiConfig,
  VideoPersistentState,
  VideoStoryboardBoard,
  VideoStoryboardConfig,
  VideoStoryboardProject,
} from '../../types';
import { createDefaultVideoState } from '../../utils/appState';
import { useToast } from '../../components/ToastSystem';
import { uploadToCos } from '../../services/tencentCosService';
import {
  generateStoryboardBoardImage,
  generateStoryboardScript,
  generateStoryboardWhiteBgImage,
  refetchStoryboardImage,
} from '../../services/videoStoryboardService';
import { processWithKieAi } from '../../services/kieAiService';
import { createZipAndDownload } from '../../utils/imageUtils';
import StoryboardSidebar from './StoryboardSidebar';
import StoryboardWorkspace from './StoryboardWorkspace';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: VideoPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<VideoPersistentState>>;
}

const createProjectId = () => `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const cloneStoryboardConfig = (config: VideoStoryboardConfig): VideoStoryboardConfig => ({
  ...config,
  productImages: [...config.productImages],
  uploadedProductUrls: [...config.uploadedProductUrls],
  scenes: [...config.scenes],
});

const fetchBlob = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源下载失败 (${response.status})`);
  return await response.blob();
};

const VideoModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const { addToast } = useToast();
  const defaultStoryboard = createDefaultVideoState().storyboard;
  const storyboard = persistentState.storyboard || defaultStoryboard;

  const setVideoState = (updater: (prev: VideoPersistentState) => VideoPersistentState) => {
    onStateChange(updater);
  };

  const setStoryboardConfig = (updater: (prev: VideoStoryboardConfig) => VideoStoryboardConfig) => {
    setVideoState((prev) => ({
      ...prev,
      storyboard: {
        ...(prev.storyboard || defaultStoryboard),
        config: updater((prev.storyboard || defaultStoryboard).config),
      },
    }));
  };

  const updateProject = (projectId: string, updater: (project: VideoStoryboardProject) => VideoStoryboardProject) => {
    setVideoState((prev) => {
      const currentStoryboard = prev.storyboard || defaultStoryboard;
      return {
        ...prev,
        storyboard: {
          ...currentStoryboard,
          projects: currentStoryboard.projects.map((project) => (project.id === projectId ? updater(project) : project)),
        },
      };
    });
  };

  const updateBoard = (projectId: string, boardId: string, updates: Partial<VideoStoryboardBoard>) => {
    updateProject(projectId, (project) => ({
      ...project,
      boards: project.boards.map((board) => (board.id === boardId ? { ...board, ...updates } : board)),
    }));
  };

  const ensureUploadedProductUrls = async (config: VideoStoryboardConfig) => {
    if (config.productImages.length === 0) throw new Error('请先上传产品图');
    if (config.uploadedProductUrls.length === config.productImages.length && config.uploadedProductUrls.every(Boolean)) {
      return config.uploadedProductUrls;
    }

    const urls = await Promise.all(config.productImages.map((file) => uploadToCos(file, apiConfig)));
    setStoryboardConfig((prev) => ({ ...prev, uploadedProductUrls: urls }));
    return urls;
  };

  const finalizeProjectStatus = (projectId: string) => {
    updateProject(projectId, (project) => {
      const hasBoardFailure = project.boards.some((board) => board.status === 'failed');
      const hasPendingWork = project.boards.some((board) => board.status === 'pending' || board.status === 'generating');
      const whiteBgFailed = project.config.generateWhiteBg && project.whiteBgStatus === 'failed';
      const whiteBgPending = project.config.generateWhiteBg && project.whiteBgStatus === 'generating';

      if (hasPendingWork || whiteBgPending) return { ...project, status: 'imaging' };
      if (hasBoardFailure || whiteBgFailed) return { ...project, status: 'failed', error: '部分分镜板生成失败' };
      return { ...project, status: 'completed', error: undefined };
    });
  };

  const generateWhiteBgForProject = async (projectId: string, config: VideoStoryboardConfig) => {
    updateProject(projectId, (project) => ({ ...project, whiteBgStatus: 'generating' }));
    const result = await generateStoryboardWhiteBgImage(config, config.uploadedProductUrls, apiConfig);

    if (result.status !== 'success') {
      updateProject(projectId, (project) => ({
        ...project,
        whiteBgStatus: 'failed',
        whiteBgTaskId: result.taskId,
      }));
      return false;
    }

    updateProject(projectId, (project) => ({
      ...project,
      whiteBgStatus: 'completed',
      whiteBgImageUrl: result.imageUrl,
      whiteBgTaskId: result.taskId,
    }));
    return true;
  };

  const generateBoardFromData = async (
    projectId: string,
    board: VideoStoryboardBoard,
    config: VideoStoryboardConfig,
    shots: VideoStoryboardProject['shots'],
    previousBoardImageUrl?: string
  ) => {
    updateBoard(projectId, board.id, {
      status: 'generating',
      error: undefined,
      previousBoardImageUrl,
    });

    const customPrompt = board.prompt && board.prompt.trim();
    if (customPrompt) {
      const inputImages = previousBoardImageUrl
        ? [...config.uploadedProductUrls, previousBoardImageUrl]
        : config.uploadedProductUrls;
      const result = await processWithKieAi(
        inputImages,
        apiConfig,
        {
          targetLanguage: 'KEEP_ORIGINAL',
          customLanguage: '',
          removeWatermark: false,
          aspectRatio: config.aspectRatio,
          quality: '2k',
          model: 'nano-banana-pro',
          resolutionMode: 'original',
          targetWidth: 0,
          targetHeight: 0,
          maxFileSize: 2,
        },
        false,
        new AbortController().signal,
        customPrompt,
        false
      );

      if (result.status !== 'success') {
        updateBoard(projectId, board.id, { status: 'failed', error: result.message || '分镜板生成失败', taskId: result.taskId });
        return false;
      }

      updateBoard(projectId, board.id, {
        status: 'completed',
        imageUrl: result.imageUrl,
        taskId: result.taskId,
        previousBoardImageUrl,
      });
      return result.imageUrl;
    }

    const generated = await generateStoryboardBoardImage(
      board,
      shots,
      config,
      config.uploadedProductUrls,
      apiConfig,
      previousBoardImageUrl
    );

    if (generated.result.status !== 'success') {
      updateBoard(projectId, board.id, {
        status: 'failed',
        error: generated.result.message || '分镜板生成失败',
        taskId: generated.result.taskId,
        prompt: generated.prompt,
        previousBoardImageUrl,
      });
      return false;
    }

    updateBoard(projectId, board.id, {
      status: 'completed',
      imageUrl: generated.result.imageUrl,
      taskId: generated.result.taskId,
      prompt: generated.prompt,
      previousBoardImageUrl,
    });
    return generated.result.imageUrl;
  };

  const processProject = async (
    projectId: string,
    config: VideoStoryboardConfig,
    sceneDescription: string,
    includeWhiteBg: boolean
  ) => {
    try {
      updateProject(projectId, (project) => ({
        ...project,
        status: 'scripting',
        error: undefined,
        sceneDescription,
        config,
      }));

      const { script, shots, boards } = await generateStoryboardScript(config, config.uploadedProductUrls, sceneDescription, apiConfig);
      updateProject(projectId, (project) => ({
        ...project,
        script,
        shots,
        boards,
        status: 'imaging',
        whiteBgStatus: includeWhiteBg ? 'pending' : undefined,
      }));

      let previousBoardImageUrl: string | undefined;
      for (const board of boards) {
        const boardImageUrl = await generateBoardFromData(projectId, board, config, shots, previousBoardImageUrl);
        if (typeof boardImageUrl === 'string') {
          previousBoardImageUrl = boardImageUrl;
        } else {
          previousBoardImageUrl = undefined;
        }
      }

      if (includeWhiteBg) {
        await generateWhiteBgForProject(projectId, config);
      }

      finalizeProjectStatus(projectId);
    } catch (error: any) {
      updateProject(projectId, (project) => ({
        ...project,
        status: 'failed',
        error: error.message || '项目生成失败',
      }));
      addToast(`项目生成失败：${error.message || '未知错误'}`, 'error');
    }
  };

  const handleGenerateWithConfig = async (baseConfig: VideoStoryboardConfig) => {
    if (persistentState.isGenerating) return;

    try {
      setVideoState((prev) => ({ ...prev, isGenerating: true }));
      const uploadedProductUrls = await ensureUploadedProductUrls(baseConfig);
      const runtimeConfig: VideoStoryboardConfig = {
        ...cloneStoryboardConfig(baseConfig),
        uploadedProductUrls,
        model: 'nano-banana-pro',
        quality: '2k',
      };
      const existingCount = storyboard.projects.length;
      const nextProjects: VideoStoryboardProject[] = Array.from({ length: runtimeConfig.projectCount }, (_, index) => ({
        id: createProjectId(),
        name: `视频方案 ${existingCount + index + 1}`,
        config: runtimeConfig,
        status: 'pending',
        script: '',
        shots: [],
        boards: [],
        createdAt: Date.now(),
        sceneDescription: runtimeConfig.scenes[index] || '',
      }));

      setVideoState((prev) => {
        const currentStoryboard = prev.storyboard || defaultStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            config: runtimeConfig,
            projects: [...nextProjects, ...currentStoryboard.projects],
          },
        };
      });

      for (let index = 0; index < nextProjects.length; index++) {
        await processProject(
          nextProjects[index].id,
          runtimeConfig,
          runtimeConfig.scenes[index] || '',
          runtimeConfig.generateWhiteBg && index === 0
        );
      }

      addToast(`已完成 ${nextProjects.length} 个视频分镜方案`, 'success');
    } catch (error: any) {
      addToast(error.message || '生成失败', 'error');
    } finally {
      setVideoState((prev) => ({ ...prev, isGenerating: false }));
    }
  };

  const handleGenerate = async () => {
    await handleGenerateWithConfig(storyboard.config);
  };

  const handleRetryProject = async (projectId: string) => {
    const project = storyboard.projects.find((item) => item.id === projectId);
    if (!project) return;
    await processProject(projectId, project.config, project.sceneDescription || '', !!project.config.generateWhiteBg);
  };

  const handleRetryFailedBoards = async (projectId: string) => {
    const project = storyboard.projects.find((item) => item.id === projectId);
    if (!project) return;

    updateProject(projectId, (current) => ({ ...current, status: 'imaging', error: undefined }));
    let previousBoardImageUrl: string | undefined;

    for (const board of project.boards) {
      if (board.status === 'completed' && board.imageUrl) {
        previousBoardImageUrl = board.imageUrl;
        continue;
      }
      if (board.status === 'failed') {
        const result = await generateBoardFromData(projectId, board, project.config, project.shots, previousBoardImageUrl);
        if (typeof result === 'string') previousBoardImageUrl = result;
      }
    }

    if (project.config.generateWhiteBg && project.whiteBgStatus === 'failed') {
      await generateWhiteBgForProject(projectId, project.config);
    }

    finalizeProjectStatus(projectId);
  };

  const handleRegenerateBoard = async (projectId: string, boardId: string) => {
    const project = storyboard.projects.find((item) => item.id === projectId);
    if (!project) return;
    const boardIndex = project.boards.findIndex((item) => item.id === boardId);
    const previousBoardImageUrl = boardIndex > 0 ? project.boards[boardIndex - 1].imageUrl : undefined;
    const board = project.boards[boardIndex];
    if (!board) return;
    await generateBoardFromData(projectId, board, project.config, project.shots, previousBoardImageUrl);
    finalizeProjectStatus(projectId);
  };

  const handleRefetchBoard = async (projectId: string, boardId: string) => {
    const project = storyboard.projects.find((item) => item.id === projectId);
    const board = project?.boards.find((item) => item.id === boardId);
    if (!board?.taskId) {
      addToast('该分镜板没有可找回的任务 ID', 'warning');
      return;
    }

    updateBoard(projectId, boardId, { status: 'generating', error: undefined });
    const result = await refetchStoryboardImage(board.taskId, apiConfig);
    if (result.status !== 'success') {
      updateBoard(projectId, boardId, { status: 'failed', error: result.message || '找回失败' });
      addToast(result.message || '找回失败', 'error');
      return;
    }

    updateBoard(projectId, boardId, { status: 'completed', imageUrl: result.imageUrl, error: undefined });
    finalizeProjectStatus(projectId);
  };

  const handleCreateNewSchemes = async (projectId: string, count: number, scenes: string[]) => {
    const project = storyboard.projects.find((item) => item.id === projectId);
    if (!project) return;
    await handleGenerateWithConfig({
      ...cloneStoryboardConfig(project.config),
      projectCount: count,
      scenes,
    });
  };

  const handleDownloadProject = async (project: VideoStoryboardProject) => {
    try {
      setVideoState((prev) => {
        const currentStoryboard = prev.storyboard || defaultStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            downloadingProjectId: project.id,
          },
        };
      });

      const files: { blob: Blob; path: string }[] = [
        {
          blob: new Blob([project.script], { type: 'text/plain;charset=utf-8' }),
          path: `${project.name}/script.txt`,
        },
      ];

      if (project.whiteBgImageUrl) {
        files.push({
          blob: await fetchBlob(project.whiteBgImageUrl),
          path: `${project.name}/product_white_bg.jpg`,
        });
      }

      const completedBoards = project.boards.filter((board) => board.imageUrl);
      for (let index = 0; index < completedBoards.length; index++) {
        files.push({
          blob: await fetchBlob(completedBoards[index].imageUrl!),
          path: `${project.name}/board_${index + 1}.jpg`,
        });
      }

      await createZipAndDownload(files, `${project.name}_${Date.now()}`);
    } catch (error: any) {
      addToast(error.message || '打包下载失败', 'error');
    } finally {
      setVideoState((prev) => {
        const currentStoryboard = prev.storyboard || defaultStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            downloadingProjectId: null,
          },
        };
      });
    }
  };

  const handleDownloadAll = async () => {
    const completedProjects = storyboard.projects.filter((project) => project.status === 'completed');
    if (completedProjects.length === 0) {
      addToast('还没有已完成的方案可下载', 'warning');
      return;
    }

    try {
      const files: { blob: Blob; path: string }[] = [];
      for (const project of completedProjects) {
        files.push({
          blob: new Blob([project.script], { type: 'text/plain;charset=utf-8' }),
          path: `${project.name}/script.txt`,
        });

        if (project.whiteBgImageUrl) {
          files.push({
            blob: await fetchBlob(project.whiteBgImageUrl),
            path: `${project.name}/product_white_bg.jpg`,
          });
        }

        const validBoards = project.boards.filter((board) => board.imageUrl);
        for (let index = 0; index < validBoards.length; index++) {
          files.push({
            blob: await fetchBlob(validBoards[index].imageUrl!),
            path: `${project.name}/board_${index + 1}.jpg`,
          });
        }
      }

      await createZipAndDownload(files, `video_storyboards_${Date.now()}`);
    } catch (error: any) {
      addToast(error.message || '批量下载失败', 'error');
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setVideoState((prev) => {
      const currentStoryboard = prev.storyboard || defaultStoryboard;
      return {
        ...prev,
        storyboard: {
          ...currentStoryboard,
          projects: currentStoryboard.projects.filter((project) => project.id !== projectId),
          downloadingProjectId:
            currentStoryboard.downloadingProjectId === projectId ? null : currentStoryboard.downloadingProjectId,
        },
      };
    });
    addToast('项目已删除', 'success');
  };

  const handleClearAllProjects = () => {
    setVideoState((prev) => {
      const currentStoryboard = prev.storyboard || defaultStoryboard;
      return {
        ...prev,
        storyboard: {
          ...currentStoryboard,
          projects: [],
          downloadingProjectId: null,
        },
      };
    });
    addToast('工作区项目已清空', 'success');
  };

  return (
    <div className="h-full flex overflow-hidden bg-slate-50">
      <StoryboardSidebar
        config={storyboard.config}
        disabled={persistentState.isGenerating}
        onChange={setStoryboardConfig}
        onGenerate={handleGenerate}
      />
      <StoryboardWorkspace
        projects={storyboard.projects}
        downloadingProjectId={storyboard.downloadingProjectId}
        onDownloadAll={handleDownloadAll}
        onClearAllProjects={handleClearAllProjects}
        onDownloadProject={handleDownloadProject}
        onDeleteProject={handleDeleteProject}
        onRetryProject={handleRetryProject}
        onRetryFailedBoards={handleRetryFailedBoards}
        onCreateNewSchemes={handleCreateNewSchemes}
        onRegenerateBoard={handleRegenerateBoard}
        onRefetchBoard={handleRefetchBoard}
        onUpdateBoard={updateBoard}
      />
    </div>
  );
};

export default VideoModule;
