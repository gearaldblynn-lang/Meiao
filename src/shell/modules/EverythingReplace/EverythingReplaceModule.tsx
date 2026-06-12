import React from 'react';
import { ReplaceAll } from 'lucide-react';
import type { Project, SubFeatureOption, Task } from '../../../ShellMigratedApp';
import ProjectListView from '../../components/ProjectListView';

interface Props {
  projects: Project[];
  tasks: Task[];
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onEditResult?: (projectId: string, resultId: string, instruction: string, files: File[]) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onCancelTask: (taskId: string) => void;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
}

const EverythingReplaceModule: React.FC<Props> = (props) => (
  <ProjectListView
    {...props}
    title="万物替换"
    description="上传待替换素材与参考画面，复刻画面结构并完成替换生成。"
    emptyIcon={<ReplaceAll size={30} strokeWidth={1} />}
    emptyTitle="开始万物替换"
    emptySubtitle="上传产品素材和替换参考图，选择替换逻辑后提交生成。"
  />
);

export default EverythingReplaceModule;
