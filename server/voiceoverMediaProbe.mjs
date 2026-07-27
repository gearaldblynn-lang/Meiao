const VIDEO_KINDS = new Set([
  'source_video',
  'golden_video',
  'final_video',
  'analysis_video',
]);
const AUDIO_KINDS = new Set([
  'original_audio',
  'vocal_audio',
  'background_audio',
  'tts_audio',
  'aligned_audio',
]);

const invalidCheckpointAsset = (message) => Object.assign(new Error(message), {
  code: 'voiceover_checkpoint_asset_invalid',
  statusCode: 409,
});

export const resolveVoiceoverExpectedMediaKind = (expectedKind) => {
  const normalized = String(expectedKind || '').trim();
  if (VIDEO_KINDS.has(normalized)) return 'video';
  if (AUDIO_KINDS.has(normalized)) return 'audio';
  throw invalidCheckpointAsset('口播翻译检查点媒体类型无效。');
};

export const probeVoiceoverManagedMedia = async ({
  filePath,
  expectedKind,
  expectedDurationMs,
  durationToleranceMs = 100,
  signal,
  probe,
} = {}) => {
  if (typeof probe !== 'function') {
    throw invalidCheckpointAsset('口播翻译媒体探测能力不可用。');
  }
  const mediaKind = resolveVoiceoverExpectedMediaKind(expectedKind);
  let metadata;
  try {
    metadata = await probe(filePath, mediaKind, signal);
  } catch {
    throw invalidCheckpointAsset('口播翻译检查点媒体不可读取。');
  }
  const durationSeconds = Number(metadata?.durationSeconds);
  const sizeBytes = Number(metadata?.sizeBytes);
  const commonValid = Number.isFinite(durationSeconds)
    && durationSeconds > 0
    && Number.isFinite(sizeBytes)
    && sizeBytes > 0;
  const typeValid = mediaKind === 'video'
    ? Boolean(
        metadata?.videoCodec
        && Number(metadata?.width) > 0
        && Number(metadata?.height) > 0
        && (expectedKind === 'source_video' || metadata?.hasAudio === true)
      )
    : Boolean(metadata?.audioCodec);
  if (!commonValid || !typeValid) {
    throw invalidCheckpointAsset('口播翻译检查点媒体为空、损坏或类型不匹配。');
  }
  const durationMs = Math.round(durationSeconds * 1000);
  if (
    Number.isFinite(Number(expectedDurationMs))
    && Number(expectedDurationMs) > 0
    && Math.abs(durationMs - Number(expectedDurationMs))
      > Math.max(0, Number(durationToleranceMs) || 0)
  ) {
    throw invalidCheckpointAsset('口播翻译检查点媒体时长与父任务不一致。');
  }
  return {
    ...metadata,
    durationMs,
    hasAudio: mediaKind === 'audio' || metadata.hasAudio === true,
  };
};
