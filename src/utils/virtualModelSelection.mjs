const FALLBACK_SLOTS = Object.freeze([
  'front_close',
  'left_45_close',
  'right_45_close',
]);

const createIncompleteAssetsError = () => {
  const error = new Error('Virtual model identity assets are incomplete.');
  error.code = 'MODEL_ASSET_INCOMPLETE';
  return error;
};

const isKnownAnalysis = (analysis) =>
  analysis &&
  typeof analysis === 'object' &&
  ['portrait', 'half_body', 'full_body'].includes(analysis.framing) &&
  ['front', 'left', 'right', 'profile'].includes(analysis.faceDirection);

const selectSlots = (analysis) => {
  if (!isKnownAnalysis(analysis)) return FALLBACK_SLOTS;

  const sameSide45 = analysis.faceDirection === 'right' ? 'right_45_close' : 'left_45_close';
  if (analysis.framing === 'full_body') {
    if (analysis.faceDirection === 'front') {
      return ['front_close', 'front_half', 'front_full'];
    }
    if (analysis.faceDirection === 'profile') {
      return ['front_close', 'three_quarter_half', 'three_quarter_full'];
    }
    return ['front_close', sameSide45, 'three_quarter_full'];
  }

  if (analysis.faceDirection === 'front') {
    return FALLBACK_SLOTS;
  }
  if (analysis.faceDirection === 'profile') {
    return ['front_close', 'profile_close', 'three_quarter_half'];
  }
  return ['front_close', sameSide45, analysis.faceDirection === 'right' ? 'three_quarter_half' : 'profile_close'];
};

export const selectVirtualModelIdentityAssets = (assets, referenceAnalysis) => {
  if (!Array.isArray(assets)) throw createIncompleteAssetsError();

  const assetsBySlot = new Map();
  assets.forEach((asset) => {
    if (asset && typeof asset === 'object' && typeof asset.slot === 'string' && !assetsBySlot.has(asset.slot)) {
      assetsBySlot.set(asset.slot, asset);
    }
  });

  const selected = selectSlots(referenceAnalysis).map((slot) => assetsBySlot.get(slot));
  if (selected.length !== 3 || selected.some((asset) => !asset) || selected[0]?.isPrimary !== true || new Set(selected.map((asset) => String(asset.assetId || '').trim())).size !== 3) {
    throw createIncompleteAssetsError();
  }
  return selected;
};

