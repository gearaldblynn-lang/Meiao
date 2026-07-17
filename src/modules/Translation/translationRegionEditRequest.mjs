import { isTranslationRegionPureEraseTask } from './translationRegionEditIntent.mjs';
import { buildTranslationRegionEditPrompt } from './translationRegionEditPrompt.mjs';

const requireImageUrl = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} must be a non-empty image url`);
  return normalized;
};

export const buildTranslationRegionEditRequest = ({
  sourceImageUrl = '',
  guideImageUrl = '',
  regions = [],
} = {}) => {
  const guideUrl = requireImageUrl(guideImageUrl, 'guideImageUrl');
  const pureErase = isTranslationRegionPureEraseTask(regions);
  const imageUrls = pureErase
    ? [guideUrl]
    : [requireImageUrl(sourceImageUrl, 'sourceImageUrl'), guideUrl];

  return {
    mode: pureErase ? 'pure_erase_single_image' : 'standard_dual_image',
    imageUrls,
    prompt: buildTranslationRegionEditPrompt({ regions }),
  };
};
