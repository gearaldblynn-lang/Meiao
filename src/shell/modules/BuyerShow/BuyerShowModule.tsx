import React from 'react';
import { Users } from 'lucide-react';
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

const BuyerShowModule: React.FC<Props> = (props) => (
  <ProjectListView
    {...props}
    title="买家秀"
    description="生成真实感买家秀场景图。模拟不同人群、场景下的产品使用效果。"
    emptyIcon={<Users size={30} strokeWidth={1} />}
    emptyTitle="生成买家秀"
    emptySubtitle="输入产品信息，选择目标人群和使用场景，AI 将生成逼真的买家秀图片"
  />
);

export default BuyerShowModule;
