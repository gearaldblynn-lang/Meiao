import React from 'react';
import { Sparkles } from 'lucide-react';
import type { Project, Task } from '../../../ShellMigratedApp';
import ProjectListView from '../../components/ProjectListView';
import type { SubFeatureOption } from '../../../ShellMigratedApp';

interface Props {
  projects: Project[];
  tasks: Task[];
  onConfirmPlan: (projectId: string, plan: any) => void;
  onUpdatePlans: (projectId: string, plans: any[]) => void;
  onRegeneratePlans: (projectId: string) => void;
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeletePlan?: (projectId: string, planId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onFissionResult?: (projectId: string, resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void;
  onEditResult?: (projectId: string, resultId: string, instruction: string, files: File[]) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onCancelTask: (taskId: string) => void;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
}

const OneClickModule: React.FC<Props> = ({
  projects, tasks,
  onConfirmPlan, onUpdatePlans, onRegeneratePlans,
  onDeleteResult, onDeleteProject, onRegenerateResult, onFissionResult, onEditResult, onRecoverResult, onCancelTask,
  onDeletePlan,
  subFeatures, activeSubFeature, onSubFeatureChange, pendingActionKeys, showGenerationProgress = true,
}) => {
  return (
    <ProjectListView
      projects={projects}
      tasks={tasks}
      title="一键主详"
      description="输入产品信息，AI 先生成策划方案，确认后批量生成主图、详情页、SKU 全套视觉"
      emptyIcon={<Sparkles size={30} strokeWidth={1} />}
      emptyTitle="当前子功能暂无项目"
      emptySubtitle="切换首图、主图、详情页或 SKU 查看各自独立项目区；新提交的真实任务会沉淀为卡片。"
      onDeleteResult={onDeleteResult}
      onDeleteProject={onDeleteProject}
      onDeletePlan={onDeletePlan}
      onRegenerateResult={onRegenerateResult}
      onFissionResult={onFissionResult}
      onEditResult={onEditResult}
      onRecoverResult={onRecoverResult}
      onCancelTask={onCancelTask}
      onConfirmPlan={onConfirmPlan}
      onUpdatePlans={onUpdatePlans}
      onRegeneratePlans={onRegeneratePlans}
      subFeatures={subFeatures}
      activeSubFeature={activeSubFeature}
      onSubFeatureChange={onSubFeatureChange}
      pendingActionKeys={pendingActionKeys}
      showGenerationProgress={showGenerationProgress}
    />
  );
};

export default OneClickModule;
