import type { SubtitleRemovalRegion } from '../types';
import { clampSubtitleRegion } from '../utils/subtitleRemovalRegion.mjs';

export type SubtitleRemovalSubmissionInput = {
  userId: string;
  sourceUrl: string;
  sourceAssetId?: string;
  sourceProjectId?: string;
  sourceResultId?: string;
  shellProjectId: string;
  shellProjectName: string;
  batchId: string;
  batchIndex: number;
  batchCount: number;
  shellResultId: string;
  draftNonce: string;
  subtitleRegionNormalized: SubtitleRemovalRegion;
};

const safeKeyPart = (value: unknown, fallback: string) => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, '_')
    .slice(0, 180);
  return normalized || fallback;
};

const managedSourceIdentity = (input: SubtitleRemovalSubmissionInput) => {
  const assetId = String(input.sourceAssetId || '').trim();
  if (assetId) return safeKeyPart(assetId, 'asset');
  try {
    const parsed = new URL(input.sourceUrl, 'https://meiao.invalid');
    return safeKeyPart(parsed.pathname, 'managed-video');
  } catch {
    return safeKeyPart(String(input.sourceUrl || '').split('?')[0], 'managed-video');
  }
};

const regionIdentity = (region: SubtitleRemovalRegion) => {
  const normalized = clampSubtitleRegion(region);
  return [normalized.x, normalized.y, normalized.width, normalized.height]
    .map((value) => Number(Number(value).toFixed(6)))
    .join(',');
};

export const buildSubtitleRemovalSubmissionKey = (input: SubtitleRemovalSubmissionInput) => [
  'subtitle_removal',
  safeKeyPart(input.userId, 'user'),
  managedSourceIdentity(input),
  regionIdentity(input.subtitleRegionNormalized),
  safeKeyPart(input.batchId, 'batch'),
  safeKeyPart(input.shellResultId, `result-${input.batchIndex}`),
  `index-${input.batchIndex}`,
  safeKeyPart(input.draftNonce, 'draft'),
].join('|');

export const buildSubtitleRemovalJobRequest = (input: SubtitleRemovalSubmissionInput) => {
  const subtitleRegionNormalized = clampSubtitleRegion(input.subtitleRegionNormalized);
  const clientSubmissionKey = buildSubtitleRemovalSubmissionKey({
    ...input,
    subtitleRegionNormalized,
  });
  return {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    maxRetries: 0,
    payload: {
      taskPurpose: 'subtitle_removal',
      subFeature: 'subtitle_removal',
      sourceUrl: input.sourceUrl,
      subtitleRegionNormalized,
      sourceProjectId: input.sourceProjectId,
      sourceResultId: input.sourceResultId,
      shellProjectId: input.shellProjectId,
      shellProjectName: input.shellProjectName,
      batchId: input.batchId,
      batchIndex: input.batchIndex,
      batchCount: input.batchCount,
      shellResultId: input.shellResultId,
      clientSubmissionKey,
    },
  };
};
