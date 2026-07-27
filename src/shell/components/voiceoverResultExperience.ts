import type { GeneratedResult } from '../../ShellMigratedApp';
import { resolveCanonicalManagedSource } from '../../services/voiceoverTranslationClient.ts';

type ManagedMediaIdentity = {
  assetId?: string;
  url?: string;
};

type VoiceoverEntryAction = {
  resultId: string;
  label: string;
  videoUrl: string;
};

type RetryOptions = {
  confirmNewProviderAttempt: boolean;
};

const resolveManagedMedia = (
  assetId: unknown,
  url: unknown,
): ManagedMediaIdentity => {
  try {
    const normalizedAssetId = String(assetId || '').trim();
    const managed = resolveCanonicalManagedSource({
      sourceAssetId: normalizedAssetId || undefined,
      sourceUrl: normalizedAssetId ? undefined : String(url || '').trim() || undefined,
    });
    return managed;
  } catch {
    return {};
  }
};

export const resolveSafeVoiceoverResultMedia = (
  result: Pick<GeneratedResult, 'sourceAssetId' | 'sourceUrl' | 'sourcePreviewUrl' | 'finalAssetId' | 'videoUrl'>,
) => {
  const original = resolveManagedMedia(
    result.sourceAssetId,
    result.sourceUrl || result.sourcePreviewUrl,
  );
  const final = resolveManagedMedia(result.finalAssetId, result.videoUrl);
  return {
    sourceAssetId: original.assetId,
    originalUrl: original.url,
    finalAssetId: final.assetId,
    finalUrl: final.url,
  };
};

export const buildVoiceoverTranslationEntryActions = ({
  enabled,
  projectSubFeature,
  results,
}: {
  enabled: boolean;
  projectSubFeature?: string;
  results: Array<Pick<GeneratedResult, 'id' | 'status' | 'videoUrl' | 'finalAssetId'>>;
}): VoiceoverEntryAction[] => {
  if (!enabled || projectSubFeature === 'voiceover_translation') return [];
  const shouldNumberResults = results.length > 1;
  return results.flatMap((result, index) => {
    if (result.status !== 'completed') return [];
    const final = resolveManagedMedia(result.finalAssetId, result.videoUrl);
    if (!final.url) return [];
    return [{
      resultId: result.id,
      label: shouldNumberResults ? `口播翻译 · 结果 ${index + 1}` : '口播翻译',
      videoUrl: final.url,
    }];
  });
};

type ProviderAttempt = {
  index?: number;
  attempt?: number;
  status?: string;
  providerTaskId?: string;
};

const needsNewProviderAttempt = (attempt?: ProviderAttempt) => (
  attempt?.status === 'failed'
  || (attempt?.status === 'submitted' && !String(attempt.providerTaskId || '').trim())
);

export const requiresVoiceoverRetryConfirmation = (
  result: Pick<GeneratedResult, 'errorCode' | 'voiceoverCheckpoint'>,
) => {
  if ([
    'provider_submission_unknown',
    'voiceover_analysis_submission_unknown',
    'voiceover_retry_confirmation_required',
  ].includes(String(result.errorCode || '').trim())) {
    return true;
  }
  const checkpoint = result.voiceoverCheckpoint;
  if (
    checkpoint?.stage === 'speech_analysis_submitting'
    && ['provider_bad_response', 'provider_config_error'].includes(
      String(result.errorCode || '').trim(),
    )
  ) {
    return true;
  }
  if (needsNewProviderAttempt(checkpoint?.subtitleRemoval)) return true;
  const latestAttemptByGroup = new Map<number, ProviderAttempt>();
  for (const group of checkpoint?.ttsGroups || []) {
    const index = Number(group.index);
    const previous = latestAttemptByGroup.get(index);
    if (!previous || Number(group.attempt) > Number(previous.attempt)) {
      latestAttemptByGroup.set(index, group);
    }
  }
  return [...latestAttemptByGroup.values()].some(needsNewProviderAttempt);
};

export const runVoiceoverRetryRequest = async ({
  result,
  submit,
  requestConfirmation,
}: {
  result: Pick<GeneratedResult, 'errorCode' | 'voiceoverCheckpoint'>;
  submit: (options: RetryOptions) => void | Promise<void>;
  requestConfirmation: () => void;
}) => {
  if (requiresVoiceoverRetryConfirmation(result)) {
    requestConfirmation();
    return;
  }
  try {
    await submit({ confirmNewProviderAttempt: false });
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && String((error as { code?: unknown }).code || '') === 'voiceover_retry_confirmation_required'
    ) {
      requestConfirmation();
      return;
    }
    throw error;
  }
};

export const switchVoiceoverPlaybackMode = ({
  currentMode,
  nextMode,
  currentVideo,
  setMode,
}: {
  currentMode: 'original' | 'final';
  nextMode: 'original' | 'final';
  currentVideo?: Pick<HTMLVideoElement, 'pause'> | null;
  setMode: (mode: 'original' | 'final') => void;
}) => {
  if (currentMode === nextMode) return;
  currentVideo?.pause();
  setMode(nextMode);
};
