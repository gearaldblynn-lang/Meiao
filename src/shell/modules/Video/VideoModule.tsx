import React, { useMemo } from 'react';
import { Clapperboard, Film, Sparkles } from 'lucide-react';
import ProjectListView from '../../components/ProjectListView';
import type { GeneratedResult, Project, SubFeatureOption, Task } from '../../../ShellMigratedApp';
import type { VideoPersistentState, VideoStoryboardProject } from '../../../types';
import { buildDiagnosisReportText, hasDiagnosisReportContent } from '../../../modules/Video/videoDiagnosisUtils.mjs';

interface Props {
  projects: Project[];
  tasks: Task[];
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onEditResult?: (projectId: string, resultId: string, instruction: string, files: File[]) => void;
  onConfirmStoryboardImaging?: (projectId: string) => void;
  onImportStoryboardToGeneration?: (project: VideoStoryboardProject, boardId?: string, boardIndex?: number, imageUrl?: string) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onCancelTask: (taskId: string) => void;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
  persistentState: VideoPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<VideoPersistentState>>;
}


const getStoryboardImageVersions = (board: VideoStoryboardProject['boards'][number]) => {
  const versions = Array.isArray(board.imageVersions) ? board.imageVersions.filter((item) => item?.imageUrl) : [];
  if (versions.length > 0) return versions;
  if (!board.imageUrl) return [];
  return [{
    id: `${board.id}:current`,
    imageUrl: board.imageUrl,
    prompt: board.prompt,
    taskId: board.taskId,
    creditsConsumed: board.creditsConsumed,
    revisionInstruction: board.revisionInstruction,
    createdAt: Date.now(),
  }];
};

const toStoryboardCards = (items: VideoStoryboardProject[]): Project[] => items.map((project) => {
  const boards = project.boards;
  const results: GeneratedResult[] = boards.map((board, index) => {
    const storyboardImageVersions = getStoryboardImageVersions(board);
    return {
      id: board.id,
      imageUrl: board.imageUrl || storyboardImageVersions[storyboardImageVersions.length - 1]?.imageUrl || '',
      prompt: board.prompt || storyboardImageVersions[storyboardImageVersions.length - 1]?.prompt || board.scriptText || project.script,
      model: project.config.model,
      aspectRatio: project.config.aspectRatio,
      status: board.status === 'failed' ? 'error' : board.status === 'generating' ? 'generating' : 'completed',
      createdAt: project.createdAt,
      module: 'video' as Project['module'],
      subFeature: 'storyboard',
      error: board.error,
      taskId: board.taskId,
      creditsConsumed: board.creditsConsumed,
      dynamicScriptPrompt: board.dynamicScriptPrompt || board.scriptText,
      storyboardBoardTitle: board.title,
      storyboardBoardIndex: index,
      storyboardBoardCount: project.boards.length,
      storyboardProjectStatus: project.status,
      storyboardImageVersions,
    };
  });
  const status: Project['status'] =
    project.status === 'completed' ? 'completed'
      : project.status === 'failed' ? 'error'
        : project.status === 'pending' ? 'generating'
          : project.status === 'awaiting_image_confirmation' ? 'planning'
          : 'generating';

  return {
    id: project.id,
    name: project.name,
    module: 'video' as Project['module'],
    status,
    createdAt: project.createdAt,
    completedAt: project.status === 'completed' ? project.createdAt : undefined,
    results,
    taskCount: Math.max(project.boards.length || project.shots.length || 1, 1),
    completedCount: Math.max(project.boards.filter((board) => board.imageUrl && board.status === 'completed').length, project.status === 'completed' ? 1 : 0),
    subFeature: 'storyboard',
    storyboardProjectStatus: project.status,
    planningTaskId: project.planningTaskId,
    creditsConsumed: project.creditsConsumed,
    error: project.error,
    storyboardSourceProject: project,
  };
});

const toDiagnosisCards = (state: VideoPersistentState): Project[] => {
  const analysis = state.diagnosis?.aiAnalysis;
  const probe = state.diagnosis?.probe;
  if (!hasDiagnosisReportContent(state.diagnosis)) return [];
  const reportText = buildDiagnosisReportText(state.diagnosis);
  const status: Project['status'] = analysis?.status === 'error' || probe?.status === 'error'
    ? 'error'
    : analysis?.status === 'success'
      ? 'completed'
      : 'generating';
  return [{
    id: 'video-diagnosis-result',
    name: '视频诊断结果',
    module: 'video' as Project['module'],
    status,
    createdAt: analysis?.completedAt || probe?.completedAt || Date.now(),
    completedAt: analysis?.completedAt ? analysis.completedAt : undefined,
    results: [{
      id: 'video-diagnosis-summary',
      imageUrl: '',
      prompt: reportText,
      model: state.diagnosis?.analysisModel || 'analysis',
      aspectRatio: 'auto',
      status: status === 'error' ? 'error' : status === 'completed' ? 'completed' : 'generating',
      createdAt: analysis?.completedAt || probe?.completedAt || Date.now(),
      module: 'video' as Project['module'],
      subFeature: 'diagnosis',
    }],
    taskCount: 1,
    completedCount: status === 'completed' ? 1 : 0,
    subFeature: 'diagnosis',
  }];
};

const VideoModule: React.FC<Props> = ({
  projects,
  tasks,
  onDeleteResult,
  onDeleteProject,
  onRegenerateResult,
  onEditResult,
  onConfirmStoryboardImaging,
  onImportStoryboardToGeneration,
  onRecoverResult,
  onCancelTask,
  subFeatures,
  activeSubFeature = 'generation',
  onSubFeatureChange,
  pendingActionKeys,
  showGenerationProgress,
  persistentState,
  onStateChange,
}) => {
  const storyboardCards = useMemo(() => toStoryboardCards(persistentState.storyboard?.projects || []), [persistentState.storyboard?.projects]);
  const diagnosisCards = useMemo(() => toDiagnosisCards(persistentState), [persistentState]);
  const activeProjects =
    activeSubFeature === 'storyboard' ? storyboardCards
      : activeSubFeature === 'diagnosis' ? diagnosisCards
        : projects;
  const activeTasks = activeSubFeature === 'generation' ? tasks : [];

  const handleProjectDelete = (projectId: string) => {
    if (activeSubFeature === 'storyboard') {
      onStateChange((prev) => ({
        ...prev,
        storyboard: {
          ...prev.storyboard,
          projects: (prev.storyboard?.projects || []).filter((project) => project.id !== projectId),
        },
      }));
      return;
    }
    if (activeSubFeature === 'diagnosis') {
      onStateChange((prev) => ({
        ...prev,
        diagnosis: {
          ...prev.diagnosis,
          probe: { ...prev.diagnosis.probe, status: 'idle', error: '', completedAt: null },
          report: { ...prev.diagnosis.report, status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
          aiAnalysis: { ...prev.diagnosis.aiAnalysis, status: 'idle', summary: '', sections: [], topActions: [], error: '', completedAt: null },
        },
      }));
      return;
    }
    onDeleteProject(projectId);
  };

  return (
    <ProjectListView
      title="短视频生成"
      description="底部输入框负责配置与提交，中间区域只展示项目状态和结果"
      emptyIcon={activeSubFeature === 'diagnosis' ? <Sparkles size={30} strokeWidth={1.3} /> : activeSubFeature === 'storyboard' ? <Clapperboard size={30} strokeWidth={1.3} /> : <Film size={30} strokeWidth={1.3} />}
      emptyTitle={activeSubFeature === 'diagnosis' ? '视频诊断结果' : activeSubFeature === 'storyboard' ? '分镜生成结果' : '生成产品短视频'}
      emptySubtitle={activeSubFeature === 'diagnosis' ? '在底部输入链接并提交诊断后，这里展示分析结果' : activeSubFeature === 'storyboard' ? '在底部配置分镜生成并提交后，这里展示分镜方案' : '上传产品素材，输入视频脚本、目标人群或卖点，提交后会在这里展示任务状态与视频结果'}
      projects={activeProjects}
      tasks={activeTasks}
      onDeleteResult={onDeleteResult}
      onDeleteProject={handleProjectDelete}
      onRegenerateResult={onRegenerateResult}
      onEditResult={onEditResult}
      onConfirmStoryboardImaging={onConfirmStoryboardImaging}
      onImportStoryboardToGeneration={onImportStoryboardToGeneration}
      onRecoverResult={onRecoverResult}
      onCancelTask={onCancelTask}
      subFeatures={subFeatures}
      activeSubFeature={activeSubFeature}
      onSubFeatureChange={onSubFeatureChange}
      pendingActionKeys={pendingActionKeys}
      showGenerationProgress={showGenerationProgress}
    />
  );
};

export default VideoModule;
