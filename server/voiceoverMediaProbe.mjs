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
const PCM_WORK_TRACK_CHANNELS = Object.freeze({
  original_audio: 2,
  vocal_audio: 2,
  background_audio: 2,
  aligned_audio: 1,
});

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
  const sampleRate = Number(metadata?.sampleRate);
  const channels = Number(metadata?.channels);
  const hasMp4Format = Array.isArray(metadata?.formatNames)
    && metadata.formatNames.some((name) => name === 'mov' || name === 'mp4');
  const hasValidAudioStream = metadata?.hasAudio === true
    && metadata?.audioCodec === 'aac'
    && Number.isFinite(sampleRate)
    && sampleRate > 0
    && Number.isFinite(channels)
    && channels > 0;
  const videoTypeValid = Boolean(
    metadata?.hasVideo === true
    && metadata?.videoCodec === 'h264'
    && metadata?.pixelFormat === 'yuv420p'
    && Number(metadata?.width) > 0
    && Number(metadata?.height) > 0
    && hasMp4Format
    && String(metadata?.containerBrand || '').trim()
    && metadata?.fastStart === true
    && (
      hasValidAudioStream
      || (expectedKind === 'source_video' && metadata?.hasAudio === false)
    )
  );
  const expectedWorkChannels = PCM_WORK_TRACK_CHANNELS[expectedKind];
  const audioTypeValid = expectedWorkChannels
    ? Boolean(
        metadata?.hasVideo === false
        && metadata?.hasAudio === true
        && metadata?.audioCodec === 'pcm_s16le'
        && sampleRate === 48000
        && channels === expectedWorkChannels
        && Array.isArray(metadata?.formatNames)
        && metadata.formatNames.includes('wav')
      )
    : Boolean(
        metadata?.hasVideo === false
        && metadata?.hasAudio === true
        && metadata?.audioCodec
        && Number.isFinite(sampleRate)
        && sampleRate > 0
        && Number.isFinite(channels)
        && channels > 0
      );
  const typeValid = mediaKind === 'video' ? videoTypeValid : audioTypeValid;
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
