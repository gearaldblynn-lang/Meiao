const SEEDANCE_REFERENCE_DURATION_HINT = '单个 2–15 秒，最多 3 个，总时长不超过 15 秒；超过 15 秒请先选择范围截取。';
const VIRAL_STORYBOARD_DURATION_HINT = '上传完整爆款视频进行拆解，不受短视频生成 15 秒参考素材上限影响。';

export function getReferenceVideoUploadPolicy({ activeSubFeature = '' } = {}) {
  return activeSubFeature === 'storyboard'
    ? {
      requiresSeedancePreparation: false,
      maxDurationSeconds: null,
      durationHint: VIRAL_STORYBOARD_DURATION_HINT,
    }
    : {
      requiresSeedancePreparation: true,
      maxDurationSeconds: 15,
      durationHint: SEEDANCE_REFERENCE_DURATION_HINT,
    };
}

export function shouldUseSeedanceMediaPreparation({
  activeSubFeature = '',
  mediaType = '',
} = {}) {
  if (mediaType !== 'referenceVideo' && mediaType !== 'audio') return false;
  if (mediaType === 'audio') return true;
  return getReferenceVideoUploadPolicy({ activeSubFeature }).requiresSeedancePreparation;
}
