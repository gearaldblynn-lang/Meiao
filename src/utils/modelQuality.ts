// @ts-nocheck
import { GenerationQuality, KieAiModel } from '../types';
import {
  MAXFORAI_IMAGE_MODEL_IDS,
  getMaxForAiImageModel,
} from './maxforaiImageModels.mjs';
import { getImageModelCapabilities } from './modelCapabilities.mjs';

export const MODEL_OPTIONS: KieAiModel[] = [
  'gpt-image-2',
  'gpt-image-2-secondary',
  ...(MAXFORAI_IMAGE_MODEL_IDS as KieAiModel[]),
  'nano-banana-2',
];

export const QUALITY_OPTIONS: { label: string; value: GenerationQuality }[] = [
  { label: '1K 快速', value: '1k' },
  { label: '2K 推荐', value: '2k' },
  { label: '4K 极致', value: '4k' },
];

export const getDefaultQualityForModel = (_model: KieAiModel): GenerationQuality =>
  '1k';

export const getQualityOptionsForModel = (model: KieAiModel) =>
  getImageModelCapabilities(model).supportsQualitySelection ? QUALITY_OPTIONS : [];

export const getModelDisplayName = (model: KieAiModel) => {
  const maxForAiModel = getMaxForAiImageModel(model);
  if (maxForAiModel) return maxForAiModel.label;
  if (model === 'nano-banana-2') return 'Nano Banana 2';
  if (model === 'gpt-image-2-secondary') return 'GPT Image 2（副）';
  return 'GPT Image 2';
};
