import type {
  OneClickGenerationContext,
  ProductRestoreAnalysisAttempt,
  ProductRestoreCancellationMarker,
  ProductRestoreCancellationReset,
} from '../types.ts';

export function cloneProductRestoreCancellationMarker(
  marker?: ProductRestoreCancellationMarker | null,
): ProductRestoreCancellationMarker | undefined;

export function cloneProductRestoreCancellationReset(
  reset?: ProductRestoreCancellationReset | null,
): ProductRestoreCancellationReset | undefined;

export function createProductRestoreCancellationReset(
  generationContext?: Pick<
    OneClickGenerationContext,
    'productRestoreCancellation' | 'productRestoreCancellationReset'
  >,
  now?: number,
): ProductRestoreCancellationReset;

export function createProductRestoreCancellationMarker(
  generationContext: Pick<
    OneClickGenerationContext,
    'productRestoreCancellation' | 'productRestoreCancellationReset'
  > | undefined,
  options?: { cancelledAt?: number; jobIds?: string[] },
): ProductRestoreCancellationMarker;

export function hasEffectiveProductRestoreCancellation(
  generationContext?: Pick<
    OneClickGenerationContext,
    'productRestoreCancellation' | 'productRestoreCancellationReset'
  >,
): boolean;

export function mergeProductRestoreAnalysisAttemptsForStorage(
  current?: readonly ProductRestoreAnalysisAttempt[] | null,
  incoming?: readonly ProductRestoreAnalysisAttempt[] | null,
): ProductRestoreAnalysisAttempt[];

export function mergeProductRestoreGenerationContextForStorage<T extends object>(
  existingContext?: T,
  incomingContext?: T,
): T | undefined;
