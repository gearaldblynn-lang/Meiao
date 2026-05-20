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
    title="产品精修"
    description="AI 驱动的商业级产品图片精修。已迁移原图精修、白底精修；其余模式标记为待制作。"
    emptyIcon={<Wand2 size={30} strokeWidth={1} />}
    emptyTitle="开始精修产品图"
    emptySubtitle="上传产品图片并描述精修要求，选择修复模式和画质，AI 将自动优化产品图片"
  />
);

export default RetouchModule;
