export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({
    formats: Object.freeze(['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff', 'gif']),
    maxFiles: 9,
    maxBytes: 30 * 1024 * 1024,
    minAspectRatio: 0.4,
    maxAspectRatio: 2.5,
    minDimension: 300,
    maxDimension: 6000,
  }),
  video: Object.freeze({
    formats: Object.freeze(['mp4', 'mov']),
    maxFiles: 3,
    minSeconds: 2,
    maxSeconds: 15,
    maxTotalSeconds: 15,
    maxBytes: 50 * 1024 * 1024,
    minAspectRatio: 0.4,
    maxAspectRatio: 2.5,
    minDimension: 300,
    maxDimension: 6000,
    minPixels: 640 * 640,
    maxPixels: 834 * 1112,
    minFrameRate: 24,
    maxFrameRate: 60,
  }),
  audio: Object.freeze({
    formats: Object.freeze(['wav', 'mp3']),
    maxFiles: 3,
    minSeconds: 2,
    maxSeconds: 15,
    maxTotalSeconds: 15,
    maxBytes: 15 * 1024 * 1024,
  }),
});

export const MEDIA_TRANSCODE_PROFILES = Object.freeze([
  'seedance_reference',
  'subtitle_removal',
  'voiceover_translation',
]);

const VOICEOVER_MP4_BRANDS = new Set(['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'dash', 'cmfc', 'cmfs']);

export function normalizeMediaTranscodeProfile(value = 'seedance_reference') {
  const profile = String(value || 'seedance_reference').trim().toLowerCase();
  if (!MEDIA_TRANSCODE_PROFILES.includes(profile)) {
    throw createMediaTranscodeError('media_profile_unsupported', '不支持这种媒体处理用途', { profile });
  }
  return profile;
}

export function createMediaTranscodeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createMediaTranscodeError(
      'media_invalid_metadata',
      `媒体 ${field} 信息无效`,
      { field, value },
    );
  }
  return parsed;
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function calculateVideoCanvas({ width, height }) {
  const sourceWidth = requirePositiveNumber(width, 'width');
  const sourceHeight = requirePositiveNumber(height, 'height');
  const ratio = sourceWidth / sourceHeight;
  const padded = ratio < MEDIA_LIMITS.video.minAspectRatio || ratio > MEDIA_LIMITS.video.maxAspectRatio;

  if (padded) {
    return ratio < MEDIA_LIMITS.video.minAspectRatio
      ? { width: 512, height: 1280, padded: true }
      : { width: 1280, height: 512, padded: true };
  }

  if (ratio >= 1) {
    if (ratio >= 1280 / 720) {
      return { width: 1280, height: even(1280 / ratio), padded: false };
    }
    return { width: even(720 * ratio), height: 720, padded: false };
  }

  if (ratio <= 720 / 1280) {
    return { width: 720, height: 1280, padded: false };
  }
  return { width: 720, height: even(720 / ratio), padded: false };
}

function finiteSeconds(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createMediaTranscodeError('media_trim_invalid', '裁剪范围无效', { field, value });
  }
  return parsed;
}

export function validateTrimRange({
  profile = 'seedance_reference',
  durationSeconds,
  startSeconds,
  endSeconds,
}) {
  const normalizedProfile = normalizeMediaTranscodeProfile(profile);
  const sourceDuration = finiteSeconds(durationSeconds, 'durationSeconds');
  const start = finiteSeconds(startSeconds, 'startSeconds');
  const end = finiteSeconds(endSeconds, 'endSeconds');
  const epsilon = 0.001;

  if (sourceDuration <= 0 || start < 0 || end <= start || end > sourceDuration + epsilon) {
    throw createMediaTranscodeError(
      'media_trim_out_of_bounds',
      '裁剪范围超出了原始媒体时长',
      { durationSeconds: sourceDuration, startSeconds: start, endSeconds: end },
    );
  }

  const selectedDuration = end - start;
  if (normalizedProfile === 'voiceover_translation') {
    return {
      startSeconds: start,
      endSeconds: end,
      durationSeconds: selectedDuration,
    };
  }
  if (normalizedProfile === 'subtitle_removal') {
    if (selectedDuration > 600) {
      throw createMediaTranscodeError(
        'media_trim_too_long',
        '去字幕视频时长不能超过 600 秒，请手动选择范围',
        { durationSeconds: selectedDuration },
      );
    }
    return {
      startSeconds: start,
      endSeconds: end,
      durationSeconds: selectedDuration,
    };
  }
  if (selectedDuration < MEDIA_LIMITS.video.minSeconds - epsilon) {
    throw createMediaTranscodeError(
      'media_trim_too_short',
      '裁剪时长不能少于 2 秒',
      { durationSeconds: selectedDuration },
    );
  }
  if (selectedDuration > MEDIA_LIMITS.video.maxSeconds + epsilon) {
    throw createMediaTranscodeError(
      'media_trim_too_long',
      '裁剪时长不能超过 15 秒，请手动选择范围',
      { durationSeconds: selectedDuration },
    );
  }

  return {
    startSeconds: start,
    endSeconds: end,
    durationSeconds: selectedDuration,
  };
}

export function validateMediaTranscodeSource({
  profile = 'seedance_reference',
  kind,
  hasVideo = false,
  hasAudio = false,
} = {}) {
  const normalizedProfile = normalizeMediaTranscodeProfile(profile);
  if (normalizedProfile !== 'voiceover_translation') return;
  if (kind !== 'video') {
    throw createMediaTranscodeError('media_kind_unsupported', '口播翻译功能仅支持视频');
  }
  if (!hasVideo) {
    throw createMediaTranscodeError('media_video_track_required', '文件中没有可用的视频画面');
  }
  if (!hasAudio) {
    throw createMediaTranscodeError('media_audio_track_required', '口播翻译视频必须包含音频轨道');
  }
}

function ffmpegSeconds(value) {
  return String(Number(Number(value).toFixed(3)));
}

export function buildVideoTranscodeArgs({
  profile = 'seedance_reference',
  inputPath,
  outputPath,
  startSeconds,
  endSeconds,
  width,
  height,
  hasAudio = false,
}) {
  const normalizedProfile = normalizeMediaTranscodeProfile(profile);
  const duration = Number(endSeconds) - Number(startSeconds);
  if (normalizedProfile === 'voiceover_translation') {
    return [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', ffmpegSeconds(startSeconds),
      '-i', inputPath,
      '-t', ffmpegSeconds(duration),
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];
  }
  if (normalizedProfile === 'subtitle_removal') {
    return [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', ffmpegSeconds(startSeconds),
      '-i', inputPath,
      '-t', ffmpegSeconds(duration),
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-movflags', '+faststart',
      outputPath,
    ];
  }
  const canvas = calculateVideoCanvas({ width, height });
  const videoFilter = [
    `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease`,
    `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
  ].join(',');

  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', ffmpegSeconds(startSeconds),
    '-i', inputPath,
    '-t', ffmpegSeconds(duration),
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', videoFilter,
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-maxrate', '5M',
    '-bufsize', '10M',
    '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
    '-movflags', '+faststart',
    outputPath,
  ];
}

export function buildAudioTranscodeArgs({ inputPath, outputPath, startSeconds, endSeconds }) {
  const duration = Number(endSeconds) - Number(startSeconds);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', ffmpegSeconds(startSeconds),
    '-i', inputPath,
    '-t', ffmpegSeconds(duration),
    '-vn',
    '-c:a', 'libmp3lame',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '192k',
    outputPath,
  ];
}

function validateDuration(kind, metadata, profile) {
  const duration = requirePositiveNumber(metadata.durationSeconds, 'durationSeconds');
  if (profile === 'voiceover_translation') {
    if (kind !== 'video') {
      throw createMediaTranscodeError('media_kind_unsupported', '口播翻译功能仅支持视频');
    }
    return;
  }
  if (profile === 'subtitle_removal') {
    if (kind !== 'video' || duration > 600) {
      throw createMediaTranscodeError(
        'media_output_invalid_duration',
        '去字幕视频时长不能超过 600 秒',
        { durationSeconds: duration },
      );
    }
    return;
  }
  const limits = MEDIA_LIMITS[kind];
  if (duration < limits.minSeconds - 0.05 || duration > limits.maxSeconds + 0.05) {
    throw createMediaTranscodeError(
      'media_output_invalid_duration',
      '转码后的媒体时长不符合 2–15 秒要求',
      { durationSeconds: duration },
    );
  }
}

function validateBytes(kind, metadata, profile) {
  const sizeBytes = requirePositiveNumber(metadata.sizeBytes, 'sizeBytes');
  if (profile === 'subtitle_removal' || profile === 'voiceover_translation') return sizeBytes;
  if (sizeBytes > MEDIA_LIMITS[kind].maxBytes) {
    throw createMediaTranscodeError(
      'media_output_too_large',
      `转码后的${kind === 'video' ? '视频' : '音频'}文件仍然过大`,
      { sizeBytes, maxBytes: MEDIA_LIMITS[kind].maxBytes },
    );
  }
}

export function validateTranscodedOutput(kind, metadata, profile = 'seedance_reference') {
  const normalizedProfile = normalizeMediaTranscodeProfile(profile);
  if (kind !== 'video' && kind !== 'audio') {
    throw createMediaTranscodeError('media_kind_unsupported', '仅支持视频或音频转码', { kind });
  }
  validateDuration(kind, metadata, normalizedProfile);
  validateBytes(kind, metadata, normalizedProfile);
  const formatNames = Array.isArray(metadata.formatNames)
    ? metadata.formatNames.map((item) => String(item).toLowerCase())
    : [];

  if (kind === 'audio') {
    if (!formatNames.includes('mp3') || String(metadata.audioCodec || '').toLowerCase() !== 'mp3') {
      throw createMediaTranscodeError('media_output_invalid_codec', '转码结果不是标准 MP3 音频');
    }
    return metadata;
  }

  if (!formatNames.includes('mp4') || String(metadata.videoCodec || '').toLowerCase() !== 'h264') {
    throw createMediaTranscodeError('media_output_invalid_codec', '转码结果不是标准 H.264 MP4 视频');
  }
  const width = requirePositiveNumber(metadata.width, 'width');
  const height = requirePositiveNumber(metadata.height, 'height');
  if (normalizedProfile === 'voiceover_translation') {
    const pixelFormat = String(metadata.pixelFormat || '').trim().toLowerCase();
    if (pixelFormat !== 'yuv420p') {
      throw createMediaTranscodeError('media_output_invalid_pixel_format', '转码结果不是兼容的 yuv420p 视频');
    }
    if (String(metadata.audioCodec || '').trim().toLowerCase() !== 'aac') {
      throw createMediaTranscodeError('media_audio_track_required', '口播翻译视频必须包含 AAC 音频轨道');
    }
    return metadata;
  }
  if (normalizedProfile === 'subtitle_removal') {
    const pixelFormat = String(metadata.pixelFormat || '').trim().toLowerCase();
    if (pixelFormat && pixelFormat !== 'yuv420p') {
      throw createMediaTranscodeError('media_output_invalid_pixel_format', '转码结果不是兼容的 yuv420p 视频');
    }
    return metadata;
  }
  const frameRate = requirePositiveNumber(metadata.frameRate, 'frameRate');
  const ratio = width / height;
  const pixels = width * height;
  if (
    width < MEDIA_LIMITS.video.minDimension
    || height < MEDIA_LIMITS.video.minDimension
    || width > MEDIA_LIMITS.video.maxDimension
    || height > MEDIA_LIMITS.video.maxDimension
    || ratio < MEDIA_LIMITS.video.minAspectRatio
    || ratio > MEDIA_LIMITS.video.maxAspectRatio
    || pixels < MEDIA_LIMITS.video.minPixels
    || pixels > MEDIA_LIMITS.video.maxPixels
  ) {
    throw createMediaTranscodeError(
      'media_output_invalid_dimensions',
      '转码后的视频尺寸或画面比例不符合模型要求',
      { width, height, ratio, pixels },
    );
  }
  if (frameRate < MEDIA_LIMITS.video.minFrameRate || frameRate > MEDIA_LIMITS.video.maxFrameRate) {
    throw createMediaTranscodeError(
      'media_output_invalid_frame_rate',
      '转码后的视频帧率不符合 24–60 FPS 要求',
      { frameRate },
    );
  }
  return metadata;
}

export function isMediaCompatibleForProfile(profile, metadata = {}) {
  const normalizedProfile = normalizeMediaTranscodeProfile(profile);
  if (normalizedProfile === 'seedance_reference') {
    const kind = metadata.kind === 'audio' ? 'audio' : metadata.kind === 'video' ? 'video' : '';
    if (!kind) return false;
    if (kind === 'video') {
      const pixelFormat = String(metadata.pixelFormat || '').trim().toLowerCase();
      if (pixelFormat !== 'yuv420p') return false;
    }
    try {
      validateTranscodedOutput(kind, metadata, normalizedProfile);
      return true;
    } catch {
      return false;
    }
  }
  if (normalizedProfile === 'voiceover_translation') {
    if (metadata.kind !== 'video') return false;
    const containerBrand = String(metadata.containerBrand || '').trim().toLowerCase();
    if (!VOICEOVER_MP4_BRANDS.has(containerBrand) || metadata.fastStart !== true) return false;
    try {
      validateTranscodedOutput('video', metadata, normalizedProfile);
      return true;
    } catch {
      return false;
    }
  }
  const formatNames = Array.isArray(metadata.formatNames)
    ? metadata.formatNames.map((item) => String(item).trim().toLowerCase())
    : [];
  const durationSeconds = Number(metadata.durationSeconds);
  const sizeBytes = Number(metadata.sizeBytes);
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const pixelFormat = String(metadata.pixelFormat || '').trim().toLowerCase();
  return durationSeconds > 0
    && durationSeconds <= 600
    && sizeBytes > 0
    && width > 0
    && height > 0
    && formatNames.includes('mp4')
    && String(metadata.videoCodec || '').trim().toLowerCase() === 'h264'
    && (!pixelFormat || pixelFormat === 'yuv420p');
}
