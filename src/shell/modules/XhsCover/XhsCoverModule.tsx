import React from 'react';
import { BookOpen } from 'lucide-react';
import type { Project, SubFeatureOption, Task } from '../../../ShellMigratedApp';
import ProjectListView from '../../components/ProjectListView';

interface Props {
  projects: Project[];
  tasks: Task[];
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onCancelTask: (taskId: string) => void;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
}

const XhsCoverModule: React.FC<Props> = (props) => (
  <ProjectListView
    {...props}
    title="小红书封面"
    description="选择单个封面预设图，主标题、副标题和内容卖点统一在底部输入框组织。"
    emptyIcon={<BookOpen size={30} strokeWidth={1} />}
    emptyTitle="生成小红书封面"
    emptySubtitle="在底部输入主标题、副标题和内容卖点，选择预设图、字体和比例后提交生成。"
  />
);

export default XhsCoverModule;
