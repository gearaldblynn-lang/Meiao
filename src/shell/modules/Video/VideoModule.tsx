import React, { useMemo } from 'react';
import { Clapperboard, Film, Sparkles } from 'lucide-react';
import ProjectListView from '../../components/ProjectListView';
import type { GeneratedResult, Project, SubFeatureOption, Task } from '../../../ShellMigratedApp';
import type { SubtitleRemovalSourceDraft, VideoPersistentState, VideoStoryboardProject } from '../../../types';
import { buildDiagnosisReportText, hasDiagnosisReportContent } from '../../../modules/Video/videoDiagnosisUtils.mjs';
import { toStoryboardShellResultStatus } from './storyboardGenerationState.mjs';
import SubtitleRemovalWorkspace, { type SubtitleRemovalSubmitInput } from '../../components/SubtitleRemovalWorkspace';

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
  subtitleRemovalDraft: SubtitleRemovalSourceDraft | null;
  onSubtitleRemovalDraftChange: (draft: SubtitleRemovalSourceDraft | null) => void;
  onSubtitleRemovalSubmit: (input: SubtitleRemovalSubmitInput) => Promise<void> | void;
  subtitleRemovalSubmitting?: boolean;
  subtitleRemovalFeatureAvailable?: boolean;
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
  const durableProject = project as VideoStoryboardProject & {
    planningJobId?: string;
    backendJobId?: string;
    boards: Array<VideoStoryboardProject['boards'][number] & { backendJobId?: string }>;
  };
  const boards = project.boards;
  const results: GeneratedResult[] = boards.map((board, index) => {
    const durableBoard = board as typeof board & { backendJobId?: string };
    const storyboardImageVersions = getStoryboardImageVersions(board);
    return {
      id: board.id,
      imageUrl: board.imageUrl || storyboardImageVersions[storyboardImageVersions.length - 1]?.imageUrl || '',
      prompt: board.prompt || storyboardImageVersions[storyboardImageVersions.length - 1]?.prompt || board.scriptText || project.script,
      model: project.config.model,
      aspectRatio: project.config.aspectRatio,
      status: toStoryboardShellResultStatus(board),
      createdAt: project.createdAt,
      module: 'video' as Project['module'],
      subFeature: 'storyboard',
      error: board.error,
      taskId: board.taskId,
      backendJobId: durableBoard.backendJobId,
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
    createdAtPrecise: true,
    completedAt: project.status === 'completed' ? project.createdAt : undefined,
    results,
    taskCount: Math.max(project.boards.length || project.shots.length || 1, 1),
    completedCount: Math.max(project.boards.filter((board) => board.imageUrl && board.status === 'completed').length, project.status === 'completed' ? 1 : 0),
    subFeature: 'storyboard',
    storyboardProjectStatus: project.status,
    planningTaskId: project.planningTaskId,
    backendJobId: [...durableProject.boards].reverse().find((board) => board.status === 'generating' && board.backendJobId)?.backendJobId
      || durableProject.backendJobId
      || durableProject.planningJobId,
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
    createdAtPrecise: true,
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
  subtitleRemovalDraft,
  onSubtitleRemovalDraftChange,
  onSubtitleRemovalSubmit,
  subtitleRemovalSubmitting,
  subtitleRemovalFeatureAvailable,
}) => {
  const storyboardCards = useMemo(() => toStoryboardCards(persistentState.storyboard?.projects || []), [persistentState.storyboard?.projects]);
  const diagnosisCards = useMemo(() => toDiagnosisCards(persistentState), [persistentState]);
  const activeProjects =
    activeSubFeature === 'storyboard' ? storyboardCards
      : activeSubFeature === 'diagnosis' ? diagnosisCards
        : projects;
  const activeTasks = activeSubFeature === 'generation' ? tasks : [];
  const subtitleRemovalWorkspace = activeSubFeature === 'subtitle_removal' ? (
    <SubtitleRemovalWorkspace
      draft={subtitleRemovalDraft}
      onDraftChange={onSubtitleRemovalDraftChange}
      onSubmit={onSubtitleRemovalSubmit}
      submitting={subtitleRemovalSubmitting}
      featureAvailable={subtitleRemovalFeatureAvailable}
    />
  ) : undefined;

  const handleProjectDelete = (projectId: string) => {
    if (activeSubFeature === 'storyboard') {
      onStateChange((prev) => ({
        ...prev,
        storyboard: {
          ...prev.storyboard,
          projects: (prev.storyboard?.projects || []).filter((project) => project.id !== projectId),
        },
      }));
      // 2026-07-09 将离分镜卡删不掉修复:只改 videoMemory 本地状态没有删除墓碑,
      // 服务端 mergeVideoMemory 对 storyboard.projects 取并集,旧卡每次同步都被并回来。
      // 必须同时走 onDeleteProject 写 deletedProjectIds 墓碑,durable 层才真正删除。
      onDeleteProject(projectId);
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
      title={activeSubFeature === 'subtitle_removal' ? '视频去字幕' : '短视频生成'}
      description={activeSubFeature === 'subtitle_removal' ? '上传原视频并选择字幕区域，任务完成后可对比原片与结果' : '底部输入框负责配置与提交，中间区域只展示项目状态和结果'}
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
      onCancelTask={activeSubFeature === 'subtitle_removal' ? undefined : onCancelTask}
      subFeatures={subFeatures}
      activeSubFeature={activeSubFeature}
      onSubFeatureChange={onSubFeatureChange}
      pendingActionKeys={pendingActionKeys}
      showGenerationProgress={showGenerationProgress}
      beforeProjects={subtitleRemovalWorkspace}
    />
  );
};

export default VideoModule;
