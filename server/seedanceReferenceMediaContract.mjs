const createBadRequest = (message, details = {}) => Object.assign(new Error(message), {
  code: 'provider_bad_request',
  providerStage: 'create_task',
  providerStatus: 'bad_request',
  details,
});

const normalizeUrls = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const normalizeDurations = (value) => Array.isArray(value) ? value : [];

const assertReferenceDurations = (label, urls, durations) => {
  if (durations.length === 0) return;
  if (durations.length !== urls.length) {
    throw createBadRequest(`${label}时长信息不完整，请重新裁剪并上传后再提交。`, {
      urlCount: urls.length,
      durationCount: durations.length,
    });
  }
  const parsed = durations.map(Number);
  const invalidIndex = parsed.findIndex((duration) => !Number.isFinite(duration) || duration < 2 || duration > 15);
  if (invalidIndex >= 0) {
    throw createBadRequest(`${label}单个文件必须为 2–15 秒。`, {
      index: invalidIndex,
      durationSeconds: parsed[invalidIndex],
    });
  }
  const total = parsed.reduce((sum, duration) => sum + duration, 0);
  if (total > 15.001) {
    throw createBadRequest(`${label}总时长不能超过 15 秒，当前为 ${Math.round(total * 10) / 10} 秒。`, {
      totalDurationSeconds: total,
    });
  }
};

export function assertSeedanceReferenceMediaContract({
  mode = 'multimodal2video',
  imageUrls,
  videoUrls,
  audioUrls,
  videoDurations,
  audioDurations,
} = {}) {
  const images = normalizeUrls(imageUrls);
  const videos = normalizeUrls(videoUrls);
  const audios = normalizeUrls(audioUrls);
  if (mode === 'multimodal2video' && images.length > 9) {
    throw createBadRequest('Seedance 参考图片最多 9 个，请删除多余素材后再提交。', { count: images.length });
  }
  if (videos.length > 3) {
    throw createBadRequest('Seedance 参考视频最多 3 个，请删除多余素材后再提交。', { count: videos.length });
  }
  if (audios.length > 3) {
    throw createBadRequest('Seedance 参考音频最多 3 个，请删除多余素材后再提交。', { count: audios.length });
  }
  assertReferenceDurations('Seedance 参考视频', videos, normalizeDurations(videoDurations));
  assertReferenceDurations('Seedance 参考音频', audios, normalizeDurations(audioDurations));
  return true;
}
