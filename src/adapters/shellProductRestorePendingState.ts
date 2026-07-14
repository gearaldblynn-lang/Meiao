import { AppModule } from '../types';

interface ProductRestoreAnalysisStateInput {
  results?: unknown;
  analysisStatus?: 'completed' | 'generating';
  analysisJobId?: string;
  message?: string;
}

type ProductRestoreMaterialMap = Record<string, unknown[] | undefined>;

export interface ProductRestoreAnalysisPendingState {
  isPending: boolean;
  project?: {
    status: 'planning';
    taskCount: number;
  };
  task?: {
    status: 'generating';
    total: number;
  };
  analysisJobId?: string;
  message?: string;
}

export const resolveProductRestoreTargetCount = (
  materials: ProductRestoreMaterialMap = {},
) => Math.max(1, (materials.restoreTarget || []).filter(Boolean).length);

export const assembleProductRestorePendingProjectTaskState = (
  materials: ProductRestoreMaterialMap = {},
) => {
  const targetCount = resolveProductRestoreTargetCount(materials);
  return {
    project: {
      status: 'planning' as const,
      taskCount: targetCount,
    },
    task: {
      status: 'generating' as const,
      total: targetCount,
    },
  };
};

export const getProductRestoreAnalysisPendingState = (
  targetModule: AppModule,
  targetSubFeature: string | undefined,
  result: ProductRestoreAnalysisStateInput,
  materials: ProductRestoreMaterialMap = {},
): ProductRestoreAnalysisPendingState => {
  if (
    targetModule !== AppModule.RETOUCH
    || targetSubFeature !== 'product_restore'
    || result.analysisStatus !== 'generating'
  ) {
    return { isPending: false };
  }
  const analysisJobId = String(result.analysisJobId || '').trim();
  const message = String(result.message || '').trim();
  return {
    isPending: true,
    ...assembleProductRestorePendingProjectTaskState(materials),
    ...(analysisJobId ? { analysisJobId } : {}),
    ...(message ? { message } : {}),
  };
};
