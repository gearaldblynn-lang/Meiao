const VOICEOVER_INTERMEDIATE_TTL_MS = 1000 * 60 * 60 * 24 * 3;

const isRemoteUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const defaultIsManagedAssetUrl = (value) => /\/api\/assets\/file\//.test(String(value || ''));

const createVoiceoverParentJobError = () => {
  const error = new Error('配音任务缺少有效的父任务归属');
  error.code = 'voiceover_parent_job_missing';
  error.providerStage = 'asset_persist';
  error.providerStatus = 'ownership_missing';
  return error;
};

const normalizeVoiceoverParentJobId = (value) => String(value || '').trim();

export const isKieTtsJob = (job) => String(job?.taskType || '').trim() === 'kie_tts';

export const assertKieTtsParentJob = (job) => {
  if (!isKieTtsJob(job)) return '';
  const parentJobId = normalizeVoiceoverParentJobId(job?.payload?.parentJobId);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(parentJobId)) {
    throw createVoiceoverParentJobError();
  }
  return parentJobId;
};

export const persistManagedRemoteJobOutput = async ({
  job,
  result = {},
  publicBaseUrl,
  persistRemoteAsset,
  isManagedAssetUrl = defaultIsManagedAssetUrl,
  now = () => Date.now(),
  getVoiceoverIntermediateExpiresAt = () => Number(now()) + VOICEOVER_INTERMEDIATE_TTL_MS,
} = {}) => {
  if (typeof persistRemoteAsset !== 'function') throw new TypeError('persistRemoteAsset is required');

  const isVoiceoverTts = isKieTtsJob(job);
  const parentJobId = assertKieTtsParentJob(job);
  const nextResult = { ...(result || {}) };
  const fields = [
    ['videoUrl', 'video', `${job?.taskType || 'result'}.mp4`, true],
    ['audioUrl', 'intermediate', `${job?.taskType || 'result'}.mp3`, false],
    ['fileUrl', 'result', `${job?.taskType || 'result'}.bin`, true],
  ];

  for (const [fieldName, assetType, originalName, retainRemoteUrl] of fields) {
    const remoteUrl = String(nextResult[fieldName] || '').trim();
    if (!isRemoteUrl(remoteUrl) || isManagedAssetUrl(remoteUrl)) continue;
    const isVoiceoverAudio = isVoiceoverTts && fieldName === 'audioUrl';
    const persisted = await persistRemoteAsset({
      publicBaseUrl,
      userId: job?.userId,
      module: job?.module,
      assetType,
      remoteUrl,
      originalName,
      provider: job?.provider,
      jobId: isVoiceoverAudio ? parentJobId : job?.id,
      ...(isVoiceoverAudio ? { expiresAt: getVoiceoverIntermediateExpiresAt() } : {}),
    });
    nextResult[fieldName] = persisted.publicUrl;
    nextResult[`${fieldName}AssetId`] = persisted.id;
    if (retainRemoteUrl) nextResult[`${fieldName}RemoteUrl`] = remoteUrl;
  }
  return nextResult;
};
