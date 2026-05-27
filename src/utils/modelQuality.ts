// @ts-nocheck
import { GenerationQuality, KieAiModel } from '../types';
import { getImageModelCapabilities } from './modelCapabilities.mjs';

export const MODEL_OPTIONS: KieAiModel[] = ['gpt-image-2', 'gpt-image-2-secondary', 'nano-banana-2'];

export const QUALITY_OPTIONS: { label: string; value: GenerationQuality }[] = [
  { label: '1K 快速', value: '1k' },
  { label: '2K 推荐', value: '2k' },
  { label: '4K 极致', value: '4k' },
];

export const getDefaultQualityForModel = (_model: KieAiModel): GenerationQuality =>
  '1k';

export const getQualityOptionsForModel = (model: KieAiModel) =>
  getImageModelCapabilities(model).supportsQualitySelection ? QUALITY_OPTIONS : [];

export const getModelDisplayName = (model: KieAiModel) =>
  model === 'nano-banana-2' ? 'Nano Banana 2' : model === 'gpt-image-2-secondary' ? 'GPT Image 2（副）' : 'GPT Image 2';
