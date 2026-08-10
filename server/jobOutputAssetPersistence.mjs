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

const createPersistentAssetBaseUnavailableError = () => {
  const error = new Error('配音结果缺少可安全持久化的公网素材地址');
  error.code = 'managed_asset_public_base_unavailable';
  error.providerStage = 'asset_persist';
  error.providerStatus = 'public_base_unavailable';
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

export const prepareKieTtsOutputForPersistence = ({
  job,
  result = {},
  publicBaseUrl,
  isManagedAssetUrl = defaultIsManagedAssetUrl,
} = {}) => {
  const nextResult = { ...(result || {}) };
  if (!isKieTtsJob(job)) return nextResult;

  assertKieTtsParentJob(job);
  delete nextResult.audioUrlRemoteUrl;
  const audioUrl = String(nextResult.audioUrl || '').trim();
  if (isRemoteUrl(audioUrl) && !isManagedAssetUrl(audioUrl) && !String(publicBaseUrl || '').trim()) {
    throw createPersistentAssetBaseUnavailableError();
  }
  return nextResult;
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
  const nextResult = prepareKieTtsOutputForPersistence({ job, result, publicBaseUrl, isManagedAssetUrl });
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
