import React, { useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import type { Project, Task, Material } from '../../../ShellMigratedApp';
import ProjectListView from '../../components/ProjectListView';
import type { SubFeatureOption } from '../../../ShellMigratedApp';
import type { TranslationEditRegion } from '../../../types';

interface Props {
  projects: Project[];
  tasks: Task[];
  materials: Record<string, Material[]>;
  onUploadMaterial: (type: string, files: FileList | null) => void;
  onRemoveMaterial: (type: string, id: string) => void;
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onCancelTask: (taskId: string) => void;
  onTranslationRegionEdit?: (projectId: string, resultId: string, input: { sourceVersionId: string; regions: TranslationEditRegion[] }) => Promise<void>;
  onCancelTranslationRegionEdit?: (projectId: string, resultId: string, versionId: string, backendJobId?: string) => Promise<void>;
  onTranslationResultDownloaded?: (projectId: string, resultId: string, sourceUrl: string, blob: Blob, fileName: string) => Promise<void>;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
}

const TranslationModule: React.FC<Props> = ({
  projects, tasks, materials,
  onUploadMaterial,
  onDeleteResult, onDeleteProject, onRegenerateResult, onRecoverResult, onCancelTask,
  onTranslationRegionEdit, onCancelTranslationRegionEdit, onTranslationResultDownloaded,
  subFeatures, activeSubFeature, onSubFeatureChange, pendingActionKeys, showGenerationProgress,
}) => {
  const productMaterials = materials['product'] || [];

  return (
    <ProjectListView
      projects={projects}
      tasks={tasks}
      title="出海翻译"
      description="自动翻译产品文案并生成多语言产品视觉"
      emptyIcon={<Globe size={30} strokeWidth={1.4} />}
      emptyTitle="开始出海翻译"
      emptySubtitle="上传产品图片后即可开始生成，底部仅保留必要配置"
      onDeleteResult={onDeleteResult}
      onDeleteProject={onDeleteProject}
      onRegenerateResult={onRegenerateResult}
      onRecoverResult={onRecoverResult}
      onCancelTask={onCancelTask}
      onTranslationRegionEdit={onTranslationRegionEdit}
      onCancelTranslationRegionEdit={onCancelTranslationRegionEdit}
      onTranslationResultDownloaded={onTranslationResultDownloaded}
      subFeatures={subFeatures}
      activeSubFeature={activeSubFeature}
      onSubFeatureChange={onSubFeatureChange}
      pendingActionKeys={pendingActionKeys}
      showGenerationProgress={showGenerationProgress}
    />
  );
};

export default TranslationModule;
