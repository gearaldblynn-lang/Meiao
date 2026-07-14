import type {
  OneClickGenerationContext,
  ProductRestoreAnalysisAttempt,
  ProductRestoreAnalysisAttemptStatus,
} from '../types';

const normalizeIdentity = (value: unknown) => String(value || '').trim();

const STRICT_NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const normalizeKnownProductRestoreCredits = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!STRICT_NON_NEGATIVE_DECIMAL.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeTimestamp = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
};

const VALID_STATUSES = new Set<ProductRestoreAnalysisAttemptStatus>([
  'running',
  'succeeded',
  'invalid',
  'failed',
  'cancelled',
]);

const STATUS_PRIORITY: Record<ProductRestoreAnalysisAttemptStatus, number> = {
  running: 0,
  failed: 1,
  cancelled: 2,
  invalid: 3,
  succeeded: 4,
};

export const createProductRestoreAnalysisAttempt = (input: {
  jobId?: unknown;
  providerTaskId?: unknown;
  model?: unknown;
  status?: unknown;
  errorCode?: unknown;
  timestamp?: unknown;
  creditsConsumed?: unknown;
}): ProductRestoreAnalysisAttempt | undefined => {
  const jobId = normalizeIdentity(input.jobId);
  if (!jobId) return undefined;
  const requestedStatus = normalizeIdentity(input.status) as ProductRestoreAnalysisAttemptStatus;
  const status = VALID_STATUSES.has(requestedStatus) ? requestedStatus : 'running';
  const providerTaskId = normalizeIdentity(input.providerTaskId);
  const model = normalizeIdentity(input.model);
  const errorCode = normalizeIdentity(input.errorCode);
  const creditsConsumed = normalizeKnownProductRestoreCredits(input.creditsConsumed);
  return {
    jobId,
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(model ? { model } : {}),
    status,
    ...(errorCode ? { errorCode } : {}),
    timestamp: normalizeTimestamp(input.timestamp),
    ...(creditsConsumed !== undefined ? { creditsConsumed } : {}),
  };
};

export const cloneProductRestoreAnalysisAttempts = (
  attempts: readonly ProductRestoreAnalysisAttempt[] | null | undefined,
): ProductRestoreAnalysisAttempt[] => (Array.isArray(attempts) ? attempts : [])
  .map((attempt) => createProductRestoreAnalysisAttempt(attempt))
  .filter((attempt): attempt is ProductRestoreAnalysisAttempt => Boolean(attempt));

export const cloneProductRestoreAnalysisAttemptsForMutation = (
  generationContext?: Pick<
    OneClickGenerationContext,
    'productRestoreAnalysisAttempts' | 'productRestore'
  >,
): ProductRestoreAnalysisAttempt[] => {
  if (Array.isArray(generationContext?.productRestoreAnalysisAttempts)) {
    return cloneProductRestoreAnalysisAttempts(
      generationContext.productRestoreAnalysisAttempts,
    );
  }
  const legacyContext = generationContext?.productRestore;
  const legacyAttempt = legacyContext
    ? createProductRestoreAnalysisAttempt({
        jobId: legacyContext.analysisJobId,
        providerTaskId: legacyContext.analysisProviderTaskId,
        model: legacyContext.analysisModel,
        status: 'succeeded',
        timestamp: legacyContext.createdAt,
        creditsConsumed: legacyContext.analysisCreditsConsumed,
      })
    : undefined;
  return legacyAttempt ? [legacyAttempt] : [];
};

export const mergeProductRestoreAnalysisAttempts = (
  current: readonly ProductRestoreAnalysisAttempt[] | null | undefined,
  incoming: readonly ProductRestoreAnalysisAttempt[] | null | undefined,
): ProductRestoreAnalysisAttempt[] => {
  const merged = cloneProductRestoreAnalysisAttempts(current);
  const byJobId = new Map(merged.map((attempt, index) => [attempt.jobId, index]));
  for (const next of cloneProductRestoreAnalysisAttempts(incoming)) {
    const index = byJobId.get(next.jobId);
    if (index === undefined) {
      byJobId.set(next.jobId, merged.length);
      merged.push(next);
      continue;
    }
    const previous = merged[index];
    const status = STATUS_PRIORITY[next.status] >= STATUS_PRIORITY[previous.status]
      ? next.status
      : previous.status;
    merged[index] = {
      ...previous,
      ...(next.providerTaskId ? { providerTaskId: next.providerTaskId } : {}),
      ...(next.model ? { model: next.model } : {}),
      status,
      ...(next.errorCode ? { errorCode: next.errorCode } : {}),
      timestamp: previous.timestamp,
      ...(next.creditsConsumed !== undefined ? { creditsConsumed: next.creditsConsumed } : {}),
    };
  }
  return merged;
};

export const getProductRestoreAnalysisCreditSummary = (
  generationContext?: Pick<
    OneClickGenerationContext,
    'productRestoreAnalysisAttempts' | 'productRestore'
  >,
): { present: boolean; value: number } => {
  if (Array.isArray(generationContext?.productRestoreAnalysisAttempts)) {
    const knownAttempts = mergeProductRestoreAnalysisAttempts(
      [],
      generationContext.productRestoreAnalysisAttempts,
    )
      .map((attempt) => normalizeKnownProductRestoreCredits(attempt?.creditsConsumed))
      .filter((value): value is number => value !== undefined);
    return knownAttempts.length > 0
      ? { present: true, value: knownAttempts.reduce((sum, value) => sum + value, 0) }
      : { present: false, value: 0 };
  }
  const legacyValue = normalizeKnownProductRestoreCredits(
    generationContext?.productRestore?.analysisCreditsConsumed,
  );
  return legacyValue !== undefined
    ? { present: true, value: legacyValue }
    : { present: false, value: 0 };
};

export const getProductRestoreTotalKnownCredits = (input: {
  generationContext?: Pick<
    OneClickGenerationContext,
    'productRestoreAnalysisAttempts' | 'productRestore'
  >;
  imageCredits: readonly unknown[];
}): { present: boolean; analysis: number; images: number; total: number } => {
  const analysis = getProductRestoreAnalysisCreditSummary(input.generationContext);
  const knownImageCredits = (input.imageCredits || [])
    .map(normalizeKnownProductRestoreCredits)
    .filter((value): value is number => value !== undefined);
  const images = knownImageCredits.reduce((sum, value) => sum + value, 0);
  return {
    present: analysis.present || knownImageCredits.length > 0,
    analysis: analysis.value,
    images,
    total: analysis.value + images,
  };
};
