const poses = Object.freeze([
  ['C01', 'front_close', '正面近景', true, '正面头部到锁骨特写，直视镜头，保留完整头发和脸部。'],
  ['C02', 'left_45_close', '左侧45度近景', false, '脸、肩线和上半身整体朝画面左侧约45度。'],
  ['C03', 'right_45_close', '右侧45度近景', false, '脸、肩线和上半身整体朝画面右侧约45度。'],
  ['C04', 'profile_close', '左侧面近景', false, '严格左侧纯侧面，只展示一侧肩膀和一只眼睛。'],
  ['C05', 'three_quarter_half', '右侧面近景', false, '严格右侧纯侧面，只展示一侧肩膀和一只眼睛。'],
  ['P05', 'front_half', '正面半身', false, '正面半身，从头部到髋部入镜。'],
  ['P01', 'front_full', '正面全身', false, '正面全身，双臂自然放松，头到鞋完整入镜。'],
  ['P03', 'three_quarter_full', '四分之三全身', false, '四分之三全身，身体整体约45度侧转，头到鞋完整入镜。'],
]);

export const VIRTUAL_MODEL_GENERATION_POSES = Object.freeze(poses.map(([poseId, slot, label, isPrimary, prompt]) => ({ poseId, slot, label, isPrimary, prompt })));
export const VIRTUAL_MODEL_BASELINE_POSE_IDS = Object.freeze(['C01', 'P01']);
export const VIRTUAL_MODEL_DERIVED_POSE_IDS = Object.freeze(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);

export const buildVirtualModelPosePrompt = ({ sourceName, poseId, referenceCount = 1, referenceRole = 'uploaded' } = {}) => {
  const pose = VIRTUAL_MODEL_GENERATION_POSES.find((item) => item.poseId === poseId);
  if (!pose) throw Object.assign(new Error('Virtual model pose is invalid'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  const baseline = referenceRole === 'baseline';
  return [
    `基于 ${Number(referenceCount || 1)} 张授权虚拟电商模特参考图“${String(sourceName || '本地模特')}”，生成一张新的 AI 模特姿势图。`,
    baseline ? '两张基准图必须同时参考：正面近景锁定头脸身份，正面全身锁定身材比例和服装。' : '综合所有上传参考图，保持同一人的发型、发色、肤色、年龄观感、体型比例和气质。',
    `目标姿势：${pose.label}。${pose.prompt}`,
    '保持人物身份一致、头部自然直立、真实摄影质感、干净浅灰摄影棚背景；只生成一个主模特，不要拼图、文字、水印或多余人物。',
  ].join('\n');
};

export const extractVirtualModelPoseResultUrl = (result = {}) => String(
  result.imageUrl || result.resultUrl || result.imageResultUrls?.[0] || result.resultUrls?.[0] || result.outputUrls?.[0] || '',
).trim();
