import { AspectRatio, KieAiModel } from '../types';

const NANO_BANANA_2_RATIOS: AspectRatio[] = [
  AspectRatio.AUTO,
  AspectRatio.SQUARE,
  AspectRatio.P_1_4,
  AspectRatio.P_1_8,
  AspectRatio.P_2_3,
  AspectRatio.L_3_2,
  AspectRatio.P_3_4,
  AspectRatio.L_4_1,
  AspectRatio.L_4_3,
  AspectRatio.P_4_5,
  AspectRatio.L_5_4,
  AspectRatio.L_8_1,
  AspectRatio.P_9_16,
  AspectRatio.L_16_9,
  AspectRatio.L_21_9,
];

const NANO_BANANA_PRO_RATIOS: AspectRatio[] = [
  AspectRatio.AUTO,
  AspectRatio.SQUARE,
  AspectRatio.P_2_3,
  AspectRatio.L_3_2,
  AspectRatio.P_3_4,
  AspectRatio.L_4_3,
  AspectRatio.P_4_5,
  AspectRatio.L_5_4,
  AspectRatio.P_9_16,
  AspectRatio.L_16_9,
  AspectRatio.L_21_9,
];

export const getSupportedAspectRatiosForModel = (model: KieAiModel): AspectRatio[] =>
  model === 'nano-banana-pro' ? NANO_BANANA_PRO_RATIOS : NANO_BANANA_2_RATIOS;

export const isAspectRatioSupportedByModel = (model: KieAiModel, ratio: AspectRatio): boolean =>
  getSupportedAspectRatiosForModel(model).includes(ratio);

export const getSafeAspectRatioForModel = (
  model: KieAiModel,
  ratio: AspectRatio,
  fallback: AspectRatio
): AspectRatio => {
  if (isAspectRatioSupportedByModel(model, ratio)) {
    return ratio;
  }

  if (isAspectRatioSupportedByModel(model, fallback)) {
    return fallback;
  }

  return getSupportedAspectRatiosForModel(model)[0] || AspectRatio.SQUARE;
};
