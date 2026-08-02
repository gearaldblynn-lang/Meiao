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
  const imageUrls = [
    requireImageUrl(sourceImageUrl, 'sourceImageUrl'),
    requireImageUrl(guideImageUrl, 'guideImageUrl'),
  ];

  return {
    mode: 'standard_dual_image',
    imageUrls,
    prompt: buildTranslationRegionEditPrompt({ regions }),
  };
};
