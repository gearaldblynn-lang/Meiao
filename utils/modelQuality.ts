import { GenerationQuality, KieAiModel } from '../types';
import { getImageModelCapabilities } from './modelCapabilities.mjs';

export const MODEL_OPTIONS: KieAiModel[] = ['nano-banana-2', 'gpt-image-2'];

export const QUALITY_OPTIONS: { label: string; value: GenerationQuality }[] = [
  { label: '1K 快速', value: '1k' },
  { label: '2K 推荐', value: '2k' },
  { label: '4K 极致', value: '4k' },
];

export const getDefaultQualityForModel = (model: KieAiModel): GenerationQuality =>
  model === 'gpt-image-2' ? '2k' : '1k';

export const getQualityOptionsForModel = (model: KieAiModel) =>
  getImageModelCapabilities(model).supportsQualitySelection ? QUALITY_OPTIONS : [];

export const getModelDisplayName = (model: KieAiModel) =>
  model === 'nano-banana-2' ? 'Nano Banana 2' : 'GPT Image 2';
