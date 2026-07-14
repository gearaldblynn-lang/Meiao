import { AppModule } from '../types';

interface ProductRestoreAnalysisStateInput {
  results?: unknown;
  analysisStatus?: 'completed' | 'generating';
  analysisJobId?: string;
  message?: string;
}

export interface ProductRestoreAnalysisPendingState {
  isPending: boolean;
  projectStatus?: 'planning';
  analysisJobId?: string;
  message?: string;
}

export const getProductRestoreAnalysisPendingState = (
  targetModule: AppModule,
  targetSubFeature: string | undefined,
  result: ProductRestoreAnalysisStateInput,
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
    projectStatus: 'planning',
    ...(analysisJobId ? { analysisJobId } : {}),
    ...(message ? { message } : {}),
  };
};
