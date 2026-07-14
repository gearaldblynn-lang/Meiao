import React from 'react';
import { Wand2 } from 'lucide-react';
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

const RetouchModule: React.FC<Props> = (props) => (
  <ProjectListView
    {...props}
    title="图片升级"
    description="AI 驱动的商业级产品图片升级。支持原图精修、白底精修与分析优先的产品还原；智能增强标记为待制作。"
    emptyIcon={<Wand2 size={30} strokeWidth={1} />}
    emptyTitle="开始升级产品图"
    emptySubtitle="选择精修或产品还原模式，上传对应素材并设置画质，AI 将按当前工作区规则处理产品图片"
  />
);

export default RetouchModule;
