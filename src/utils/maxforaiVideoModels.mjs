export const MAXFORAI_VIDEO_MODEL = Object.freeze({
  id: 'maxforai-sora-v9-pro',
  label: 'Seedance 2.0 Pro 特价',
  upstreamModel: 'seedance2.0pro-720',
  provider: 'maxforai',
  taskType: 'maxforai_video',
  displayPriceCnyPerSecond: 0.5,
  supportedModes: Object.freeze(['multimodal2video']),
  supportedAspectRatios: Object.freeze(['16:9', '9:16', '1:1']),
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 4,
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxVideoDurationSeconds: 15,
  maxAudioDurationSeconds: 15,
  resolution: '720p',
});

export const MAXFORAI_VIDEO_MODEL_ID = MAXFORAI_VIDEO_MODEL.id;

export const isMaxForAiVideoModel = (value = '') => (
  String(value || '').trim() === MAXFORAI_VIDEO_MODEL_ID
);

export const normalizeMaxForAiVideoSeconds = (value) => {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  if (
    Number.isFinite(parsed)
    && parsed >= MAXFORAI_VIDEO_MODEL.minSeconds
    && parsed <= MAXFORAI_VIDEO_MODEL.maxSeconds
  ) {
    return parsed;
  }
  return MAXFORAI_VIDEO_MODEL.defaultSeconds;
};

export const normalizeMaxForAiVideoAspectRatio = (value) => {
  const ratio = String(value || '').trim();
  return MAXFORAI_VIDEO_MODEL.supportedAspectRatios.includes(ratio) ? ratio : '16:9';
};

export const formatMaxForAiVideoPrice = (seconds) => (
  normalizeMaxForAiVideoSeconds(seconds) * MAXFORAI_VIDEO_MODEL.displayPriceCnyPerSecond
).toFixed(2);

const sumKnownDurations = (items = []) => items.reduce((sum, value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
}, 0);

export const assertMaxForAiVideoMediaContract = ({
  imageUrls = [],
  videoUrls = [],
  audioUrls = [],
  videoDurations = [],
  audioDurations = [],
} = {}) => {
  if (imageUrls.length > MAXFORAI_VIDEO_MODEL.maxImages) {
    throw new Error('Seedance 2.0 Pro 特价参考图片最多 9 张。');
  }
  if (videoUrls.length > MAXFORAI_VIDEO_MODEL.maxVideos) {
    throw new Error('Seedance 2.0 Pro 特价参考视频最多 3 个。');
  }
  if (audioUrls.length > MAXFORAI_VIDEO_MODEL.maxAudios) {
    throw new Error('Seedance 2.0 Pro 特价参考音频最多 3 个。');
  }
  if (sumKnownDurations(videoDurations) > MAXFORAI_VIDEO_MODEL.maxVideoDurationSeconds) {
    throw new Error('Seedance 2.0 Pro 特价参考视频合计时长不能超过 15 秒。');
  }
  if (sumKnownDurations(audioDurations) > MAXFORAI_VIDEO_MODEL.maxAudioDurationSeconds) {
    throw new Error('Seedance 2.0 Pro 特价参考音频合计时长不能超过 15 秒。');
  }
};
