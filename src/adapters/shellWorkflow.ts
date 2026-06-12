import {
  AppModule,
  AspectRatio,
  BuyerShowSubMode,
  GenerationQuality,
  GlobalApiConfig,
  KieAiResult,
  KieAiModel,
  ModuleConfig,
  OneClickConfig,
  OneClickSubMode,
  SkuConfig,
} from '../types';
import { cancelInternalJob, createInternalJob, uploadInternalAssetStream, storeActiveModuleContext, waitForInternalJob } from '../services/internalApi';
import { processWithKieAi } from '../services/kieAiService';
import { analyzeRetouchTask, generateBuyerShowPrompts, generateDetailPageReplicationSchemes, generateFirstImageReplicationSchemes, generateMainImageSetReplicationSchemes, generateMarketingSchemes, generateSkuSchemes } from '../services/arkService';
import { buildOneClickImagePrompt } from '../modules/OneClick/generationPromptUtils';
import { XHS_COVER_STYLES } from '../modules/XhsCover/xhsCoverStyles';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';
import { extractShellSchemeField } from './shellSchemeFields';
import { getImageDimensions, getImageDimensionsFromUrl, resizeImage } from '../utils/imageUtils';
import { normalizeFetchedImageBlob } from '../utils/imageBlobUtils.mjs';
import { persistGeneratedAsset } from '../services/persistedAssetClient';
import { resolveShellSkuCount } from './shellSkuCount';
import { buildShellImageInputUrls } from './shellOneClickMaterials.mjs';
import { getExactAspectRatioFromDimensions, resolveNearestSupportedAspectRatio } from '../utils/aspectRatioUtils';
import { getSupportedAspectRatiosForModel } from '../utils/modelAspectRatio';
import { loadShellDraftAsset } from '../utils/shellDraftAssetStore';
import {
  createDefaultLogoPlacement,
  createEverythingReplaceLogoPlacementGuide,
} from '../utils/everythingReplaceLogoPlacement.mjs';

export { extractShellSchemeField } from './shellSchemeFields';

export interface ShellMaterialInput {
  id: string;
  type: string;
  url: string;
  remoteUrl?: string;
  localAssetId?: string;
  fileName: string;
  subFeature?: string;
  giftIndex?: number;
  originalWidth?: number;
  originalHeight?: number;
  logoPlacement?: Record<string, unknown>;
}

export interface ShellGenerateInput {
  module: AppModule;
  subFeature?: string;
  prompt: string;
  params: Record<string, string>;
  materials: Record<string, ShellMaterialInput[]>;
  signal: AbortSignal;
  taskMetadata?: Record<string, unknown>;
  onJobCreated?: (jobId: string, providerTaskId?: string) => void;
  publicBaseUrl?: string;
}

export interface ShellPlanItem {
  id: string;
  title: string;
  sellingPoints: string[];
  sceneDescription: string;
  styleDirection: string;
  colorPalette: string;
  composition: string;
  textLayout: string;
  selected: boolean;
  schemeContent: string;
  sourceReferenceUrl?: string;
  sourceReferenceLabel?: string;
  sourceReferenceWidth?: number;
  sourceReferenceHeight?: number;
  referenceMatchedAspectRatio?: string;
  aspectRatio?: string;
  variationMode?: 'scene' | 'palette' | 'custom';
  variationInstruction?: string;
  sourceResultUrl?: string;
  status?: 'error';
  error?: string;
  planningFailed?: boolean;
}

export interface ShellWorkflowImageResult {
  imageUrl: string;
  prompt: string;
  taskId?: string;
  backendJobId?: string;
  creditsConsumed?: number;
  model: string;
  aspectRatio: string;
  fileName?: string;
  sourceUrl?: string;
  error?: string;
  status?: 'completed' | 'generating' | 'error';
  message?: string;
  errorCode?: string;
  batchIndex?: number;
}

const MODULE_LABELS: Record<string, string> = {
  [AppModule.ONE_CLICK]: '一键主详',
  [AppModule.TRANSLATION]: '出海翻译',
  [AppModule.BUYER_SHOW]: '买家秀',
  [AppModule.RETOUCH]: '产品精修',
  [AppModule.EVERYTHING_REPLACE]: '万物替换',
  [AppModule.VIDEO]: '短视频',
  [AppModule.XHS_COVER]: '小红书封面',
};

const toModel = (value?: string): KieAiModel => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('nano') || normalized.includes('banana')) return 'nano-banana-2';
  if (normalized.includes('secondary') || normalized.includes('副')) return 'gpt-image-2-secondary';
  if (normalized.includes('gpt')) return 'gpt-image-2';
  return 'gpt-image-2';
};

const toQuality = (value?: string): GenerationQuality => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('4')) return '4k';
  if (normalized.includes('2')) return '2k';
  return '1k';
};

const toAspectRatio = (value?: string): AspectRatio => {
  const normalized = String(value || '').trim();
  const allowed = new Set(Object.values(AspectRatio));
  return allowed.has(normalized as AspectRatio) ? normalized as AspectRatio : AspectRatio.AUTO;
};

const firstParam = (params: Record<string, string>, keys: string[], fallback = '') => {
  for (const key of keys) {
    const value = params[key];
    if (value) return value;
  }
  return fallback;
};

const parseSeedanceGenerateAudio = (params: Record<string, string>) => {
  const raw = firstParam(params, ['generateAudio', 'generate_audio', 'videoGenerateAudio'], 'true');
  const normalized = String(raw || '').trim().toLowerCase();
  return !['false', '0', 'off', 'no', '关闭', '否'].includes(normalized);
};

const normalizeShellAssetUrl = (url: string, publicBaseUrl = '') => resolvePublicAssetUrl(url, publicBaseUrl);

const requireShellAssetUrl = (url: string, publicBaseUrl = '', label = '素材') => {
  const trimmed = String(url || '').trim();
  const safeUrl = normalizeShellAssetUrl(trimmed, publicBaseUrl);
  if (trimmed && !safeUrl) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  return safeUrl;
};

const toPositiveInt = (value: string, fallback = 0) => {
  const parsed = parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toPositiveFloat = (value: string, fallback = 2) => {
  const parsed = parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getDefaultShellTargetSize = (input: ShellGenerateInput) => {
  if (input.module === AppModule.TRANSLATION) {
    if (input.subFeature === 'detail') return { width: 750, height: 0 };
    if (input.subFeature === 'remove_text') return { width: 1200, height: 0 };
    return { width: 800, height: 800 };
  }
  if (input.module === AppModule.ONE_CLICK) {
    return { width: input.subFeature === 'detail_page' ? 750 : 800, height: 0 };
  }
  if (input.module === AppModule.RETOUCH || input.module === AppModule.EVERYTHING_REPLACE) {
    return { width: 800, height: 1200 };
  }
  return { width: 0, height: 0 };
};

const hasShellSizeControls = (input: ShellGenerateInput) =>
  input.module === AppModule.ONE_CLICK
  || input.module === AppModule.TRANSLATION
  || input.module === AppModule.RETOUCH
  || input.module === AppModule.EVERYTHING_REPLACE;

const toResolutionMode = (value?: string): ModuleConfig['resolutionMode'] => {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'custom'
    || normalized.includes('custom')
    || normalized.includes('自定义')
    || normalized.includes('固定')
  ) {
    return 'custom';
  }
  return 'original';
};

const normalizeDreaminaMode = (value?: string) => {
  const normalized = String(value || '').trim();
  if (normalized === 'image2video' || normalized === '全能参考' || normalized === 'multimodal' || normalized === 'ref2video') return 'multimodal2video';
  if (normalized === '首尾帧' || normalized === 'frames' || normalized === 'firstLastFrame') return 'frames2video';
  if (normalized === '智能多帧' || normalized === '多帧成片' || normalized === 'multiframe') return 'multiframe2video';
  if (['frames2video', 'multiframe2video', 'multimodal2video'].includes(normalized)) return normalized;
  return 'multimodal2video';
};

const normalizeDreaminaDuration = (value?: string) => {
  const parsed = Number.parseFloat(String(value || '').replace('秒/段', '').replace('秒', '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
};

const normalizeDreaminaAccessMode = (mode: string, value?: string) => {
  if (mode === 'multiframe2video') return 'cli';
  const normalized = String(value || '').trim();
  if (normalized === 'seedance2.0fast_vip' || normalized === 'cli') return 'cli';
  return 'api';
};

const normalizeSeedanceApiResolution = (value?: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '720p' ? '720p' : '480p';
};

const normalizeDreaminaTransitionPrompts = (value: string, fallbackPrompt: string, transitionCount: number) => {
  const prompts = String(value || '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (transitionCount <= 0) return [];
  return Array.from({ length: transitionCount }).map((_, index) => prompts[index] || fallbackPrompt || '自然连贯转场');
};

const normalizeDreaminaTransitionDurations = (value: string, fallbackDuration: number, transitionCount: number) => {
  const durations = String(value || '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (transitionCount <= 0) return [];
  return Array.from({ length: transitionCount }).map((_, index) => durations[index] || String(fallbackDuration || 3));
};

const collectMaterialUrls = (items: ShellMaterialInput[] | undefined, publicBaseUrl = '') =>
  (items || []).map((item) => materialUrl(item, publicBaseUrl)).filter(Boolean);

const materialUrl = (material: ShellMaterialInput, publicBaseUrl = '') => requireShellAssetUrl(material.remoteUrl || material.url, publicBaseUrl, '素材');

const firstMaterialUrl = (items: ShellMaterialInput[] | undefined, publicBaseUrl = '', label = '素材') => {
  const first = (items || []).find(Boolean);
  return first ? materialUrl(first, publicBaseUrl) : '';
};

const getImageResultModelLabel = (config: ModuleConfig) =>
  config.model === 'nano-banana-2' ? 'Nano Banana 2' : config.model === 'gpt-image-2-secondary' ? 'GPT Image 2（副）' : 'GPT Image 2';

const normalizeKieAiResult = (result: Partial<KieAiResult> | null | undefined): KieAiResult => {
  const status = String(result?.status || '');
  if (['success', 'error', 'generating', 'interrupted', 'task_not_found'].includes(status)) {
    return {
      ...(result || {}),
      imageUrl: String(result?.imageUrl || ''),
      status: status as KieAiResult['status'],
    };
  }
  return {
    imageUrl: String(result?.imageUrl || ''),
    videoUrl: result?.videoUrl,
    taskId: result?.taskId,
    backendJobId: result?.backendJobId,
    status: 'error',
    message: String(result?.message || '图像任务返回空结果，请稍后重试或同步任务。'),
    errorCode: String(result?.errorCode || 'empty_generation_result'),
    creditsConsumed: result?.creditsConsumed,
  };
};

const getOneClickProductUrls = (input: ShellGenerateInput) => (input.materials.product || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
const getOneClickReferenceUrls = (input: ShellGenerateInput) => [
  ...(input.materials.styleRef || []),
  ...(input.materials.reference || []),
].map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
const getOneClickLogoUrl = (input: ShellGenerateInput) => firstMaterialUrl(input.materials.logo, input.publicBaseUrl || '', '品牌logo');

const getDetailReferenceAspectRatios = (input: ShellGenerateInput) => {
  const isDetailSetReplication = input.module === AppModule.ONE_CLICK
    && input.subFeature === 'detail_page'
    && firstParam(input.params, ['detailGenerationMode'], 'AI直出') === '套图复刻'
    && toAspectRatio(firstParam(input.params, ['ratio', 'aspectRatio'], AspectRatio.AUTO)) === AspectRatio.AUTO;
  if (!isDetailSetReplication) return [];
  const autoGeneratableRatios = getSupportedAspectRatiosForModel(toModel(firstParam(input.params, ['model'], 'GPT Image 2')))
    .filter((ratio) => ratio !== AspectRatio.AUTO);
  return [
    ...(input.materials.styleRef || []),
    ...(input.materials.reference || []),
  ]
    .map((item) => resolveNearestSupportedAspectRatio(
      getExactAspectRatioFromDimensions(item.originalWidth, item.originalHeight),
      autoGeneratableRatios,
    ))
    .filter(Boolean);
};

const normalizePlatformType = (value?: string): OneClickConfig['platformType'] => {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('cross') || normalized.includes('跨境') || normalized.includes('global') ? 'crossborder' : 'domestic';
};

const toOneClickSubMode = (subFeature?: string): OneClickSubMode => {
  if (subFeature === 'detail_page') return OneClickSubMode.DETAIL_PAGE;
  if (subFeature === 'sku') return OneClickSubMode.SKU;
  if (subFeature === 'first_image') return OneClickSubMode.FIRST_IMAGE;
  return OneClickSubMode.MAIN_IMAGE;
};

const buildOneClickConfig = (input: ShellGenerateInput): OneClickConfig => {
  const moduleConfig = buildShellModuleConfig(input);
  return {
    description: input.prompt.trim(),
    planningLogic: firstParam(input.params, ['planningLogic'], ''),
    platformType: normalizePlatformType(firstParam(input.params, ['platformType'], 'domestic')),
    platform: firstParam(input.params, ['platform'], '淘宝'),
    language: firstParam(input.params, ['language', 'lang'], '中文'),
    count: toPositiveInt(firstParam(input.params, ['count'], input.subFeature === 'detail_page' ? '7' : input.subFeature === 'first_image' ? '1' : '5'), 1),
    aspectRatio: moduleConfig.aspectRatio,
    firstImageColorMode: String(input.params.firstImageColorMode || '').includes('参考') || input.params.firstImageColorMode === 'reference_locked'
      ? 'reference_locked'
      : 'product_adaptive',
    detailGenerationMode: firstParam(input.params, ['detailGenerationMode'], 'AI直出') === '套图复刻' ? '套图复刻' : 'AI直出',
    detailColorMode: String(input.params.detailColorMode || '').includes('参考') || input.params.detailColorMode === 'reference_locked'
      ? 'reference_locked'
      : 'product_adaptive',
    quality: moduleConfig.quality,
    model: moduleConfig.model,
    styleStrength: 'medium',
    resolutionMode: moduleConfig.resolutionMode,
    targetWidth: moduleConfig.targetWidth || undefined,
    targetHeight: moduleConfig.targetHeight || undefined,
    maxFileSize: moduleConfig.maxFileSize,
  };
};

const buildSkuConfig = (input: ShellGenerateInput): SkuConfig => {
  const moduleConfig = buildShellModuleConfig(input);
  const count = resolveShellSkuCount(input.params);
  const combinations = Array.from({ length: Math.min(count, 20) }).map((_, index) => {
    const skuCopyText = String(input.params[`skuCopyText_${index}`] || '').trim();
    return {
      id: `sku-${index + 1}`,
      sceneDescription: '',
      skuCopyText: skuCopyText || `SKU ${index + 1}`,
    };
  });
  return {
    productInfo: firstParam(input.params, ['skuProductInfo', 'productInfo'], ''),
    language: firstParam(input.params, ['language', 'lang'], '中文'),
    count: combinations.length,
    combinations,
    aspectRatio: moduleConfig.aspectRatio,
    quality: moduleConfig.quality,
    model: moduleConfig.model,
    styleStrength: 'medium',
    resolutionMode: moduleConfig.resolutionMode,
    targetWidth: moduleConfig.targetWidth || undefined,
    targetHeight: moduleConfig.targetHeight || undefined,
    maxFileSize: moduleConfig.maxFileSize,
  };
};

const toShellPlan = (scheme: string, index: number, sourceReferenceUrl?: string): ShellPlanItem => {
  const title = extractShellSchemeField(scheme, ['屏序/类型', 'SKU标识', '参考图标识']) || `策划方案 ${index + 1}`;
  const designIntent = extractShellSchemeField(scheme, ['设计意图']);
  const visualStyle = extractShellSchemeField(scheme, ['画面风格', '视觉风格']);
  const sceneDescription = extractShellSchemeField(scheme, ['画面描述', '场景描述']) || scheme.trim().slice(0, 160);
  const copyLayout = extractShellSchemeField(scheme, ['文案内容排版', '文案排版']);
  const ratio = extractShellSchemeField(scheme, ['画面比例', '比例']);
  return {
    id: `plan-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    sellingPoints: [designIntent || visualStyle || title].filter(Boolean),
    sceneDescription,
    styleDirection: visualStyle || designIntent,
    colorPalette: extractShellSchemeField(scheme, ['配色', '色调', '画面比例']) || ratio,
    composition: extractShellSchemeField(scheme, ['构图', '版式', '排版']) || ratio,
    textLayout: copyLayout || scheme.trim(),
    selected: true,
    schemeContent: scheme.trim(),
    sourceReferenceUrl,
  };
};

const toFailedShellPlan = (message: string, index: number, sourceReferenceUrl?: string): ShellPlanItem => {
  const errorMessage = String(message || '当前参考图策划失败').trim();
  return {
    id: `plan-failed-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title: `首图参考 ${index + 1}：策划失败`,
    sellingPoints: [],
    sceneDescription: errorMessage,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: errorMessage,
    selected: false,
    schemeContent: errorMessage,
    sourceReferenceUrl,
    status: 'error',
    error: errorMessage,
    planningFailed: true,
  };
};

export const runShellOneClickPlanning = async (input: ShellGenerateInput): Promise<{ plans: ShellPlanItem[]; message?: string; creditsConsumed?: number; taskId?: string }> => {
  const productUrls = getOneClickProductUrls(input);
  if (productUrls.length === 0) {
    throw new Error('请先上传产品素材，再启动一键主详策划。');
  }

  const apiConfig: GlobalApiConfig = {
    kieApiKey: '',
    concurrency: 1,
    workspacePreferences: input.params.__workspacePreferences
      ? JSON.parse(input.params.__workspacePreferences)
      : undefined,
  };
  const subMode = toOneClickSubMode(input.subFeature);
  storeActiveModuleContext(input.module);

  if (subMode === OneClickSubMode.FIRST_IMAGE) {
    const referenceUrls = getOneClickReferenceUrls(input);
    if (referenceUrls.length === 0) {
      throw new Error('首图功能必须先上传封面/首图参考图，才能进入复刻策划。');
    }
    const result = await generateFirstImageReplicationSchemes(
      productUrls,
      referenceUrls,
      buildOneClickConfig(input),
      apiConfig,
      input.signal,
      getOneClickLogoUrl(input) || null,
      input.onJobCreated,
      input.taskMetadata || {},
    );
    const perReferenceResults = Array.isArray(result.perReferenceResults) ? result.perReferenceResults : [];
    if (perReferenceResults.length === 0) {
      throw new Error(result.message || '首图策划失败');
    }
    return {
      plans: perReferenceResults.map((item, index) => (
        item.status === 'success'
          ? toShellPlan(item.scheme, index, item.referenceUrl)
          : toFailedShellPlan(item.message || result.message || '当前参考图策划失败', index, item.referenceUrl || referenceUrls[index])
      )),
      message: result.message,
      creditsConsumed: result.creditsConsumed,
      taskId: result.taskId,
    };
  }

  if (subMode === OneClickSubMode.SKU) {
    const giftUrls = [...(input.materials.gift || [])]
      .sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0))
      .map((item) => materialUrl(item, input.publicBaseUrl || ''))
      .filter(Boolean);
    const result = await generateSkuSchemes(
      productUrls,
      giftUrls,
      firstMaterialUrl(input.materials.styleRef, input.publicBaseUrl || '') || null,
      buildSkuConfig(input),
      apiConfig,
      input.signal,
      null,
      input.onJobCreated,
      input.taskMetadata || {},
    );
    if (result.status !== 'success' || result.schemes.length === 0) {
      throw new Error(result.message || 'SKU策划失败');
    }
    return { plans: result.schemes.map((scheme, index) => toShellPlan(scheme, index)), message: result.message, creditsConsumed: result.creditsConsumed, taskId: result.taskId };
  }

  if (subMode === OneClickSubMode.MAIN_IMAGE && firstParam(input.params, ['planningLogic'], '') === '套图复刻') {
    const referenceUrls = getOneClickReferenceUrls(input).slice(0, 5);
    if (referenceUrls.length === 0) {
      throw new Error('套图复刻必须先上传参考套图，最多 5 张。');
    }
    const result = await generateMainImageSetReplicationSchemes(
      productUrls,
      referenceUrls,
      { ...buildOneClickConfig(input), count: referenceUrls.length },
      apiConfig,
      input.signal,
      getOneClickLogoUrl(input) || null,
      input.onJobCreated,
      input.taskMetadata || {},
    );
    if (result.status !== 'success' || result.schemes.length === 0) {
      throw new Error(result.message || '主图套图复刻策划失败');
    }
    return {
      plans: result.schemes.map((scheme, index) => toShellPlan(scheme, index, referenceUrls[index])),
      message: result.message,
      creditsConsumed: result.creditsConsumed,
      taskId: result.taskId,
    };
  }

  if (subMode === OneClickSubMode.DETAIL_PAGE && firstParam(input.params, ['detailGenerationMode'], 'AI直出') === '套图复刻') {
    const referenceUrls = getOneClickReferenceUrls(input).slice(0, 10);
    if (referenceUrls.length === 0) {
      throw new Error('详情页套图复刻需要先上传 1-10 张风格参考图。');
    }
    const result = await generateDetailPageReplicationSchemes(
      productUrls,
      referenceUrls,
      { ...buildOneClickConfig(input), count: referenceUrls.length },
      apiConfig,
      input.signal,
      getOneClickLogoUrl(input) || null,
      input.onJobCreated,
      input.taskMetadata || {},
      getDetailReferenceAspectRatios(input),
    );
    if (result.status !== 'success' || result.schemes.length === 0) {
      throw new Error(result.message || '详情页套图复刻策划失败');
    }
    return {
      plans: result.schemes.map((scheme, index) => toShellPlan(scheme, index, referenceUrls[index])),
      message: result.message,
      creditsConsumed: result.creditsConsumed,
      taskId: result.taskId,
    };
  }

  const result = await generateMarketingSchemes(
    productUrls,
    firstMaterialUrl(input.materials.styleRef, input.publicBaseUrl || '') || firstMaterialUrl(input.materials.reference, input.publicBaseUrl || '') || null,
    buildOneClickConfig(input),
    apiConfig,
    subMode,
    null,
    input.signal,
    null,
    getOneClickLogoUrl(input) || null,
    input.onJobCreated,
    input.taskMetadata || {},
  );
  if (result.status !== 'success' || result.schemes.length === 0) {
    throw new Error(result.message || '一键主详策划失败');
  }
  return { plans: result.schemes.map((scheme, index) => toShellPlan(scheme, index)), message: result.message, creditsConsumed: result.creditsConsumed, taskId: result.taskId };
};

const getBuyerShowSetCount = (params: Record<string, string>) => {
  const parsed = parseInt(String(params.setCount || '1套'), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 4);
};

const buildBuyerShowSetDirectionLines = (params: Record<string, string>) => {
  const setCount = getBuyerShowSetCount(params);
  const perSetLines = Array.from({ length: setCount })
    .map((_, index) => {
      const value = String(params[`buyerShowSetDirection_${index}`] || '').trim();
      return value ? `第${index + 1}套场景要求：${value}` : '';
    })
    .filter(Boolean);

  if (perSetLines.length > 0) return perSetLines;
  const legacyDirections = String(params.setDirections || '').trim();
  return legacyDirections ? [`多套场景要求：${legacyDirections}`] : [];
};

const buildOrderedMaterialsForGeneration = (input: ShellGenerateInput) => {
  if (input.module === AppModule.ONE_CLICK && input.subFeature === 'sku') {
    const productMaterials = input.materials.product || [];
    const giftMaterials = [...(input.materials.gift || [])]
      .sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0));
    const styleMaterials = input.materials.styleRef || input.materials.reference || [];
    return [...productMaterials, ...giftMaterials, ...styleMaterials];
  }
  return Object.values(input.materials).flat();
};

const buildMaterialManifest = (input: ShellGenerateInput) => {
  const publicBaseUrl = input.publicBaseUrl || '';
  const describeLine = (label: string, url: string, assetLabel = '素材') => {
    const safeUrl = requireShellAssetUrl(url, publicBaseUrl, assetLabel);
    return safeUrl ? `${label}：${safeUrl}` : label;
  };
  if (input.module === AppModule.BUYER_SHOW) {
    const productLines = (input.materials.product || [])
      .map((item, index) => describeLine(`产品主体图${index + 1}`, materialUrl(item, publicBaseUrl), `产品主体图${index + 1}`))
      .filter(Boolean);
    const atmosphereLines = (input.materials.atmosphere || [])
      .map((item, index) => {
        const safeUrl = requireShellAssetUrl(materialUrl(item, publicBaseUrl), publicBaseUrl, `视觉氛围参考图${index + 1}`);
        return safeUrl
          ? `视觉氛围参考图${index + 1}：${safeUrl}。用于环境风格、光线、生活感和画面氛围，不替代产品主体。`
          : `视觉氛围参考图${index + 1}。用于环境风格、光线、生活感和画面氛围，不替代产品主体。`;
      })
      .filter(Boolean);
    const modelLines = (input.materials.model || [])
      .map((item, index) => {
        const safeUrl = requireShellAssetUrl(materialUrl(item, publicBaseUrl), publicBaseUrl, `模特面部与姿势参考图${index + 1}`);
        return safeUrl
          ? `模特面部与姿势参考图${index + 1}：${safeUrl}。用于参考人物面部气质、姿势、手部动作与拍摄状态，不改变目标市场人群设定。`
          : `模特面部与姿势参考图${index + 1}。用于参考人物面部气质、姿势、手部动作与拍摄状态，不改变目标市场人群设定。`;
      })
      .filter(Boolean);
    const setDirectionLines = buildBuyerShowSetDirectionLines(input.params);
    const lines = [...productLines, ...atmosphereLines, ...modelLines, ...setDirectionLines];
    if (lines.length === 0) return '';
    return [
      '买家秀素材清单：',
      ...lines,
      '请严格区分素材角色：产品图决定商品真实外观；视觉氛围参考图决定环境氛围；模特参考图只用于面部与姿势参考。',
    ].join('\n');
  }
  if (input.module !== AppModule.ONE_CLICK || input.subFeature !== 'sku') return '';
  const productLines = (input.materials.product || [])
    .map((item, index) => describeLine(`商品主体图${index + 1}`, materialUrl(item, publicBaseUrl), `商品主体图${index + 1}`))
    .filter(Boolean);
  const giftLines = [...(input.materials.gift || [])]
    .sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0))
    .map((item, index) => describeLine(`赠品${item.giftIndex || index + 1}`, materialUrl(item, publicBaseUrl), `赠品${item.giftIndex || index + 1}`))
    .filter(Boolean);
  const styleLines = (input.materials.styleRef || [])
    .map((item, index) => describeLine(`SKU风格参考图${index + 1}`, materialUrl(item, publicBaseUrl), `SKU风格参考图${index + 1}`))
    .filter(Boolean);
  const lines = [...productLines, ...giftLines, ...styleLines];
  if (lines.length === 0) return '';
  return [
    'SKU素材清单：',
    ...lines,
    '请严格按以上编号理解素材：赠品编号由前端上传顺序决定，不存在品牌Logo素材；不得把赠品图当作品牌Logo使用。',
  ].join('\n');
};

const buildXhsPresetPrompt = (params: Record<string, string>) => {
  const selectedIds = String(params.selectedStyleIds || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const styles = XHS_COVER_STYLES.filter((style) => selectedIds.includes(style.id));
  if (styles.length === 0) return '';
  return [
    '小红书封面预设库：',
    ...styles.map((style, index) => [
      `预设${index + 1}：${style.name}（${style.category}）`,
      style.prompt,
    ].join('\n')),
    '以上预设来自旧版小红书封面预设库，生成时必须优先遵循选中预设的版式、字体、配色、装饰和氛围要求。',
  ].join('\n\n');
};

export const buildShellModuleConfig = (input: ShellGenerateInput): ModuleConfig => {
  const quality = toQuality(firstParam(input.params, ['quality', 'resolution'], '1K'));
  const defaultSize = getDefaultShellTargetSize(input);
  const resolutionMode = toResolutionMode(firstParam(input.params, ['resolutionMode', 'sizeMode'], hasShellSizeControls(input) ? 'custom' : 'original'));
  const targetWidth = toPositiveInt(firstParam(input.params, ['targetWidth', 'width'], String(defaultSize.width)), defaultSize.width);
  const targetHeight = toPositiveInt(firstParam(input.params, ['targetHeight', 'height'], String(defaultSize.height)), defaultSize.height);
  const maxFileSize = toPositiveFloat(firstParam(input.params, ['maxFileSize', 'maxSize'], '2'), 2);
  const defaultAspectRatio = input.module === AppModule.ONE_CLICK
    ? (input.subFeature === 'detail_page' ? AspectRatio.AUTO : AspectRatio.SQUARE)
    : input.module === AppModule.XHS_COVER
      ? AspectRatio.P_3_4
    : AspectRatio.AUTO;
  return {
    targetLanguage: firstParam(input.params, ['lang', 'language'], 'English'),
    customLanguage: '',
    removeWatermark: false,
    aspectRatio: toAspectRatio(firstParam(input.params, ['ratio', 'aspectRatio'], defaultAspectRatio)),
    quality,
    model: toModel(firstParam(input.params, ['model'], 'GPT Image 2')),
    resolutionMode,
    targetWidth: resolutionMode === 'custom' ? targetWidth : 0,
    targetHeight: resolutionMode === 'custom' ? targetHeight : 0,
    maxFileSize,
  };
};

const maybeResizeAndPersistImageResult = async (
  imageUrl: string,
  sourceName: string,
  config: ModuleConfig,
  signal: AbortSignal,
) => {
  if (config.resolutionMode !== 'custom' || (config.targetWidth <= 0 && config.targetHeight <= 0)) {
    return imageUrl;
  }

  try {
    const response = await fetch(imageUrl, { signal });
    if (!response.ok) throw new Error(`获取生成图片失败: ${response.status}`);
    const blob = await normalizeFetchedImageBlob(await response.blob(), imageUrl);
    let width = config.targetWidth;
    let height = config.targetHeight;
    if (width > 0 && height === 0) {
      const dims = await getImageDimensions(blob);
      height = Math.round(width / (dims.ratio || 1));
    } else if (height > 0 && width === 0) {
      const dims = await getImageDimensions(blob);
      width = Math.round(height * (dims.ratio || 1));
    }
    if (width <= 0 || height <= 0) return imageUrl;
    const resizedBlob = await resizeImage(blob, width, height, config.maxFileSize);
    return persistGeneratedAsset(resizedBlob, 'shell-result', sourceName);
  } catch (error) {
    console.warn('[MEIAO] shell result resize failed, keeping provider output', error);
    return imageUrl;
  }
};

export const uploadShellMaterial = async (
  module: AppModule,
  type: string,
  file: File,
  signal?: AbortSignal
): Promise<ShellMaterialInput> => {
  const localUrl = URL.createObjectURL(file);
  const material: ShellMaterialInput = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    url: localUrl,
    fileName: file.name,
  };

  try {
    const uploaded = await uploadInternalAssetStream({
      module,
      file,
      fileName: file.name,
      signal,
    });
    material.remoteUrl = uploaded.fileUrl;
  } catch (error) {
    console.warn('Material remote upload failed, keeping local preview only.', error);
  }

  return material;
};

export const runShellImageGeneration = async (input: ShellGenerateInput) => {
  const productImageUrls = (input.materials.product || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
  const giftImageUrls = (input.materials.gift || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
  const supplementalImageUrls = (input.materials.reference || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
  const suiteReferenceUrls = input.module === AppModule.ONE_CLICK && input.subFeature === 'main_image' && input.params.planningLogic === '套图复刻'
    ? (input.materials.styleRef || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean).slice(0, 5)
    : [];
  const imageUrls = buildShellImageInputUrls({
    module: input.module,
    subFeature: input.subFeature,
    materials: input.materials,
    publicBaseUrl: input.publicBaseUrl || '',
    taskMetadata: input.taskMetadata || {},
  } as any);
  if (imageUrls.length === 0) {
    throw new Error('请先上传产品图或参考素材，再提交生成任务。');
  }

  storeActiveModuleContext(input.module);
  const config = buildShellModuleConfig(input);
  const moduleLabel = MODULE_LABELS[input.module] || input.module;
  const materialManifest = buildMaterialManifest(input);
  const xhsPresetPrompt = input.module === AppModule.XHS_COVER ? buildXhsPresetPrompt(input.params) : '';
  const useNativeTranslationPrompt = input.module === AppModule.TRANSLATION;
  const oneClickSchemeContent = typeof input.taskMetadata?.schemeContent === 'string'
    ? input.taskMetadata.schemeContent.trim()
    : '';
  const everythingReplaceEditPrompt = input.module === AppModule.EVERYTHING_REPLACE
    && input.subFeature === 'product_replace'
    && typeof input.taskMetadata?.sourceResultUrl === 'string'
    && typeof input.taskMetadata?.editInstruction === 'string'
    && input.taskMetadata.editInstruction.trim()
      ? buildEverythingReplaceResultEditPrompt({
        previousResultUrl: input.taskMetadata.sourceResultUrl,
        editInstruction: input.taskMetadata.editInstruction,
        productUrls: productImageUrls,
        publicBaseUrl: input.publicBaseUrl || '',
      })
    : '';
  const customPrompt = oneClickSchemeContent && input.module === AppModule.ONE_CLICK
    ? buildOneClickImagePrompt({
        schemeContent: oneClickSchemeContent,
        language: firstParam(input.params, ['language', 'lang'], '中文'),
        platform: input.subFeature === 'first_image' ? firstParam(input.params, ['platform'], '淘宝') : null,
        logoUrl: getOneClickLogoUrl(input) || null,
        replicationReferenceUrl: typeof input.taskMetadata?.sourceReferenceUrl === 'string' ? input.taskMetadata.sourceReferenceUrl : null,
        replicationReferenceLabel: input.subFeature === 'detail_page' || input.subFeature === 'detail' ? '详情页套图参考图' : null,
        previousResultUrl: typeof input.taskMetadata?.sourceResultUrl === 'string' ? input.taskMetadata.sourceResultUrl : null,
        variationInstruction: typeof input.taskMetadata?.variationInstruction === 'string' ? input.taskMetadata.variationInstruction : null,
        editInstruction: typeof input.taskMetadata?.editInstruction === 'string' ? input.taskMetadata.editInstruction : null,
        productUrls: [...productImageUrls, ...giftImageUrls],
        supplementalReferenceUrls: supplementalImageUrls,
        suiteReferenceUrls,
        hasProductReferences: (input.materials.product || []).length > 0,
        includeCopyGuardrails: true,
        publicBaseUrl: input.publicBaseUrl || '',
      })
    : everythingReplaceEditPrompt
      ? everythingReplaceEditPrompt
    : [
        `模块：${moduleLabel}`,
        input.subFeature ? `子功能：${input.subFeature}` : '',
        `用户需求：${input.prompt.trim()}`,
        `前端参数：${JSON.stringify(input.params)}`,
        xhsPresetPrompt,
        materialManifest,
        '请严格围绕上传素材完成对应电商视觉任务，保持商品主体一致，输出可直接用于当前模块结果展示的图片。',
      ].filter(Boolean).join('\n');

  const apiConfig: GlobalApiConfig = {
    kieApiKey: '',
    concurrency: 1,
    workspacePreferences: input.params.__workspacePreferences
      ? JSON.parse(input.params.__workspacePreferences)
      : undefined,
  };

  const rawResult = await processWithKieAi(
    imageUrls,
    apiConfig,
    config,
    config.aspectRatio !== AspectRatio.AUTO,
    input.signal,
    useNativeTranslationPrompt ? undefined : customPrompt,
    input.subFeature === 'remove_text'
      || input.params.mode === 'remove_text'
      || input.params.submode === '去文案',
    undefined,
    input.subFeature === 'detail_page' || input.subFeature === 'detail' || (input.module === AppModule.TRANSLATION && input.params.mode === 'detail') ? 'detail'
      : input.subFeature === 'remove_text' || (input.module === AppModule.TRANSLATION && input.params.mode === 'remove_text') ? 'remove_text'
        : 'main',
    {
      ...(input.subFeature ? { subFeature: input.subFeature, subMode: input.subFeature } : {}),
      ...(input.taskMetadata || {}),
    },
    input.onJobCreated,
  );
  const result = normalizeKieAiResult(rawResult);
  const finalImageUrl = result.status === 'success' && result.imageUrl
    ? await maybeResizeAndPersistImageResult(
        result.imageUrl,
        String(input.taskMetadata?.sourceFileName || input.taskMetadata?.shellPlanId || input.taskMetadata?.batchIndex || 'result.png'),
        config,
        input.signal,
      )
    : result.imageUrl;
  return { ...result, imageUrl: finalImageUrl, prompt: useNativeTranslationPrompt ? input.prompt || customPrompt : customPrompt };
};

const getBuyerShowProductUrls = (input: ShellGenerateInput) =>
  (input.materials.product || []).map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);

const getBuyerShowReferenceUrl = (input: ShellGenerateInput) =>
  firstMaterialUrl(input.materials.atmosphere, input.publicBaseUrl || '', '买家秀氛围参考图')
  || firstMaterialUrl(input.materials.styleRef, input.publicBaseUrl || '', '买家秀风格参考图')
  || firstMaterialUrl(input.materials.model, input.publicBaseUrl || '', '买家秀模特参考图')
  || '';

const buildBuyerShowState = (input: ShellGenerateInput) => {
  const config = buildShellModuleConfig({
    ...input,
    params: {
      ...input.params,
      ratio: input.params.ratio || input.params.aspectRatio || '3:4',
      aspectRatio: input.params.aspectRatio || input.params.ratio || '3:4',
    },
  });
  const imageCount = Math.min(toPositiveInt(firstParam(input.params, ['count'], '4'), 4), 20);
  const setCount = Math.min(toPositiveInt(firstParam(input.params, ['setCount'], '1'), 1), 4);
  const targetCountry = firstParam(input.params, ['market', 'targetCountry'], '中国');
  const includeModel = firstParam(input.params, ['target'], '含模特') !== '仅静物';
  return {
    subMode: BuyerShowSubMode.INTEGRATED,
    productImages: [],
    uploadedProductUrls: [],
    referenceImage: null,
    uploadedReferenceUrl: null,
    referenceStrength: 'medium' as const,
    productName: firstParam(input.params, ['productName'], ''),
    productFeatures: input.prompt.trim(),
    userRequirement: input.prompt.trim(),
    targetCountry,
    includeModel,
    aspectRatio: config.aspectRatio === AspectRatio.AUTO ? AspectRatio.P_3_4 : config.aspectRatio,
    quality: config.quality,
    model: config.model,
    imageCount,
    setCount,
    sets: [],
    tasks: [],
    evaluationText: '',
    pureEvaluations: [],
    firstImageConfirmed: false,
    isAnalyzing: false,
    isGenerating: false,
  };
};

const buildBuyerShowImagePrompt = (
  prompt: string,
  productUrls: string[],
  refUrl: string | null,
  isFirstImage: boolean,
  includeModel: boolean,
  targetCountry: string,
) => {
  const realismPrompt = 'Real iPhone snapshot posted by an everyday user — casual, unretouched, no studio lighting, no professional composition. Slight lens distortion, imperfect framing, natural ambient light. The scene feels lived-in and genuine, not staged.';
  let refDescription = '';
  if (refUrl) {
    refDescription = isFirstImage
      ? ` VISUAL REFERENCE PRIORITY: High. Visual atmosphere reference image (URL=${refUrl}) determines the environment style and lighting vibe. Do not copy its composition; place the product naturally in a similar setting.`
      : ` SCENE & CHARACTER CONSISTENCY: Reference benchmark image (URL=${refUrl}) establishes the reality of this set. Reference benchmark image (URL=${refUrl}) is the first generated image from this same buyer-show set. Treat that benchmark image as the single source of truth for person identity, room layout, props, lighting, and camera reality. This new shot MUST stay in the same session continuity but clearly differ in composition, framing, action focus, and product storytelling purpose.`;
  }
  const baseRequirement = includeModel
    ? `People in the scene must look like real locals from ${targetCountry} — natural and relaxed, not model-posed. If a person is shown, they should look like a local user from ${targetCountry}.${refDescription}`
    : `No people. Product placed naturally in a real everyday environment.${refDescription}`;
  const productPreservation = 'PACKAGING CONSISTENCY FIRST: Keep the packaging identity exactly consistent with the uploaded product images. Strictly do not change the product\'s appearance details, size, structure, label information, packaging information, packaging layout, brand marks, color blocking, or any visible product elements. Do not redesign, rewrite, simplify, replace, or newly invent the package artwork or brand presentation. The product must appear at its true real-world physical size relative to the scene. REAL SCENE INTEGRATION: The product must feel naturally photographed inside the scene with correct contact, perspective, scale, shadows, and occlusion.';
  const materialLine = productUrls.length > 0 ? `\nProduct references: ${productUrls.join(', ')}` : '';
  return `${realismPrompt}\n${baseRequirement}\n${productPreservation}${materialLine}\n\n${isFirstImage ? 'SCENE' : 'NEXT SHOT'}: ${prompt}`;
};

export const runShellBuyerShowWorkflow = async (
  input: ShellGenerateInput,
  onItemCompleted?: (item: ShellWorkflowImageResult, index: number, total: number) => void,
): Promise<{ results: ShellWorkflowImageResult[]; creditsConsumed?: number }> => {
  if (input.subFeature && input.subFeature !== 'image') {
    throw new Error('该买家秀子功能待制作，当前只迁移了 3000 的买家秀图片工作流。');
  }
  const productUrls = getBuyerShowProductUrls(input);
  if (productUrls.length === 0) throw new Error('请先上传产品素材，再生成买家秀。');

  storeActiveModuleContext(input.module);
  const apiConfig: GlobalApiConfig = {
    kieApiKey: '',
    concurrency: 1,
    workspacePreferences: input.params.__workspacePreferences ? JSON.parse(input.params.__workspacePreferences) : undefined,
  };
  const state = buildBuyerShowState(input);
  const firstReferenceUrl = getBuyerShowReferenceUrl(input) || null;
  const config: ModuleConfig = {
    targetLanguage: 'zh',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: state.aspectRatio,
    quality: state.quality,
    model: state.model,
    resolutionMode: 'original',
    targetWidth: 0,
    targetHeight: 0,
    maxFileSize: 2,
  };
  const results: ShellWorkflowImageResult[] = [];
  const total = state.imageCount * state.setCount;

  for (let setIndex = 0; setIndex < state.setCount; setIndex += 1) {
    const plan = await generateBuyerShowPrompts(productUrls, firstReferenceUrl, state, apiConfig, setIndex, input.signal);
    if (plan.status === 'error' || plan.tasks.length === 0) {
      throw new Error(plan.message || '买家秀策划失败');
    }
    let tasks = [...plan.tasks].slice(0, state.imageCount);
    if (state.includeModel) {
      const firstFaceIndex = tasks.findIndex((task) => task.hasFace);
      if (firstFaceIndex > 0) {
        const [faceTask] = tasks.splice(firstFaceIndex, 1);
        tasks = [faceTask, ...tasks];
      }
    }

    let setBenchmarkUrl: string | null = firstReferenceUrl;
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex];
      const isFirstImage = taskIndex === 0;
      const currentBatchIndex = setIndex * state.imageCount + taskIndex + 1;
      const prompt = buildBuyerShowImagePrompt(
        task.prompt,
        productUrls,
        isFirstImage ? firstReferenceUrl : setBenchmarkUrl,
        isFirstImage,
        state.includeModel,
        state.targetCountry,
      );
      const publishPendingBuyerShowJob = (jobId: string, providerTaskId?: string) => {
        input.onJobCreated?.(jobId, providerTaskId);
        const backendJobId = String(jobId || '').trim() || undefined;
        const visibleTaskId = String(providerTaskId || '').trim() || undefined;
        const pendingItem: ShellWorkflowImageResult = {
          imageUrl: '',
          prompt,
          taskId: visibleTaskId,
          backendJobId,
          model: getImageResultModelLabel(config),
          aspectRatio: config.aspectRatio,
          fileName: `方案${setIndex + 1}-图${taskIndex + 1}`,
          status: 'generating',
          error: visibleTaskId ? '任务已提交云端，正在生成...' : '任务正在提交云端...',
          message: visibleTaskId ? '任务已提交云端，正在生成...' : '任务正在提交云端...',
          batchIndex: currentBatchIndex,
        };
        onItemCompleted?.(pendingItem, currentBatchIndex, total);
      };
      const generation = await processWithKieAi(
        isFirstImage && firstReferenceUrl ? [...productUrls, firstReferenceUrl] : setBenchmarkUrl ? [...productUrls, setBenchmarkUrl] : productUrls,
        apiConfig,
        config,
        false,
        input.signal,
        prompt,
        false,
        undefined,
        'main',
        {
          ...(input.taskMetadata || {}),
          subFeature: input.subFeature || 'image',
          batchIndex: currentBatchIndex,
          batchCount: total,
          setIndex: setIndex + 1,
          setCount: state.setCount,
          imageIndex: taskIndex + 1,
          imageCount: state.imageCount,
        },
        publishPendingBuyerShowJob,
      );
      if (generation.status !== 'success' || !generation.imageUrl) {
        if (generation.taskId) {
          const pendingItem: ShellWorkflowImageResult = {
            imageUrl: '',
            prompt,
            taskId: generation.taskId,
            backendJobId: generation.backendJobId,
            model: getImageResultModelLabel(config),
            aspectRatio: config.aspectRatio,
            fileName: `方案${setIndex + 1}-图${taskIndex + 1}`,
            status: generation.status === 'generating' ? 'generating' : 'error',
            error: generation.message || `买家秀第 ${setIndex + 1} 套第 ${taskIndex + 1} 张生成失败`,
            message: generation.message,
            errorCode: generation.errorCode,
            batchIndex: currentBatchIndex,
          };
          results.push(pendingItem);
          onItemCompleted?.(pendingItem, currentBatchIndex, total);
          if (generation.status === 'generating') break;
        }
        throw new Error(generation.message || `买家秀第 ${setIndex + 1} 套第 ${taskIndex + 1} 张生成失败`);
      }
      if (isFirstImage) setBenchmarkUrl = generation.imageUrl;
      const item: ShellWorkflowImageResult = {
        imageUrl: generation.imageUrl,
        prompt: [
          `方案 ${setIndex + 1} / 图片 ${taskIndex + 1}`,
          task.style ? `风格：${task.style}` : '',
          plan.evaluation ? `评价文案：${plan.evaluation}` : '',
          prompt,
        ].filter(Boolean).join('\n\n'),
        taskId: generation.taskId,
        backendJobId: generation.backendJobId,
        creditsConsumed: generation.creditsConsumed,
        model: getImageResultModelLabel(config),
        aspectRatio: config.aspectRatio,
        fileName: `方案${setIndex + 1}-图${taskIndex + 1}`,
        status: 'completed',
        batchIndex: currentBatchIndex,
      };
      results.push(item);
      onItemCompleted?.(item, currentBatchIndex, total);
    }
  }

  return {
    results,
    creditsConsumed: results.reduce((sum, item) => sum + (Number(item.creditsConsumed) || 0), 0) || undefined,
  };
};

type ShellRetouchMode = 'original' | 'white_bg' | 'product_replace';

const getRetouchMode = (input: ShellGenerateInput): ShellRetouchMode => {
  const value = String(input.subFeature || input.params.mode || '').trim();
  if (input.module === AppModule.EVERYTHING_REPLACE && (value === 'product_replace' || value.includes('产品'))) return 'product_replace';
  if (value === 'white_bg' || value.includes('白底')) return 'white_bg';
  if (value === 'original' || value.includes('原图') || !value) return 'original';
  throw new Error('该产品精修子功能待制作，当前只迁移了 3000 的原图精修和白底精修。');
};

const buildRetouchPrompt = (sourceUrl: string, referenceUrl: string | null, analysisDescription: string, mode: 'original' | 'white_bg', aspectRatio: AspectRatio) => {
  let finalPrompt = referenceUrl ? `${sourceUrl} 为待精修图，${referenceUrl} 为精修参考效果图。\n\n` : '';
  finalPrompt += `【核心精修指令】：\n${analysisDescription}\n\n`;
  let strictStandards = '【严格执行标准】：\n';
  strictStandards += '1. 主体保真与防锐化：严禁改变品牌 Logo、标签文字内容。严禁对产品/包装上的文字和标识进行过度锐化，必须保证包装上的所有文字清晰无误、不产生畸变、重影 or 笔画断裂。\n';
  strictStandards += '2. 风格精准重塑：必须严格执行上述指令中定义的渲染风格，禁止模糊化执行，确保光影氛围与材质表达高度商业化。\n';
  if (mode === 'original') {
    strictStandards += '3. 原图连续性：原图精修必须严格基于待精修图当前画面做优化，只允许做质感、光影、透视、瑕疵、色彩和局部细节修正。\n';
    strictStandards += '4. 禁止重绘：禁止把原图精修做成重新换背景、换场景、换产品摆法、换镜头角度的大幅重绘。\n';
    strictStandards += '5. 内容克制：若无明确指令，不得新增原图中不存在的产品、道具、装饰元素或额外视觉主体。\n';
  }
  if (mode === 'white_bg') {
    strictStandards += '3. 构图占比优化：若原图中产品主体占比过小，必须将产品主体放大至占满画面约 80%-90% 的空间，以提高商品画面占比，增强视觉重心。\n';
  }
  strictStandards += `${mode === 'original' ? '6' : '4'}. 比例自适应：适配 ${aspectRatio} 比例构图。`;
  return finalPrompt + strictStandards;
};

const normalizeReplacementLogic = (value?: string) => {
  const normalized = String(value || '').trim();
  return normalized === 'combination_replace' || normalized.includes('组合') ? 'combination_replace' : 'single_replace';
};

const normalizeProductReplaceStrength = (value?: string) => {
  const normalized = String(value || '').trim();
  if (normalized === 'global_adjust' || normalized.includes('全局')) return 'global_adjust';
  if (normalized === 'person_adjust' || normalized === 'scene_adaptive' || normalized.includes('人物') || normalized.includes('自适应')) return 'person_adjust';
  return 'exact_replicate';
};

const normalizeProductReplaceTextPolicy = (value?: string) => {
  const normalized = String(value || '').trim();
  if (normalized === 'remove_text' || normalized.includes('去除') || normalized.includes('移除') || normalized.includes('删除')) return 'remove_text';
  return 'keep_text';
};

const buildProductReplaceStrengthConstraint = (referenceStrength: string) => {
  if (referenceStrength === 'person_adjust') {
    return '人物微调：保持参考图的场景、构图、动作、光影、景别和整体商业拍摄质感；若参考图出现人物，必须重绘为不同人物，脸型、五官比例、可识别面部特征、发型轮廓或发丝走向都要有明确变化，不得保留为同一张脸，不得只做几乎不可见的轻微修饰。';
  }
  if (referenceStrength === 'global_adjust') {
    return '全局微调：保持参考图的大致构图、主题、信息层级和商业风格；人物、场景、动作和局部细节允许轻微变化。';
  }
  return '完全复刻：除被替换产品和指定 Logo 外，参考图中的场景、构图、人物、动作、光影和整体风格尽量保持一致。';
};

const buildProductReplaceTextPolicyBlock = (textPolicy: string) => (
  textPolicy === 'remove_text'
    ? '去除文案：去除参考图中的所有宣传文案内容，并自然修复背景。不得影响产品素材自身的 Logo、标签、包装文字，也不得去除上传 Logo。'
    : '维持文案：参考图中的所有非产品宣传文案均不做任何变动，保持原文案内容、语言、位置、字号层级和排版关系。'
);

const formatRoleUrls = (urls: string[], fallback: string) => urls.length > 0 ? urls.join('、') : fallback;

const buildEverythingReplaceResultEditPrompt = ({
  previousResultUrl,
  editInstruction,
  productUrls,
  publicBaseUrl,
}: {
  previousResultUrl?: string | null;
  editInstruction?: string | null;
  productUrls: string[];
  publicBaseUrl?: string;
}) => {
  const safePreviousResultUrl = resolvePublicAssetUrl(previousResultUrl || '', publicBaseUrl || '');
  const safeProductUrls = productUrls
    .map((url) => resolvePublicAssetUrl(url || '', publicBaseUrl || ''))
    .filter(Boolean);
  const instruction = String(editInstruction || '').trim();
  return [
    `产品素材图：${formatRoleUrls(safeProductUrls, '已上传原素材图')}（公网url）`,
    `需修改基准图：${safePreviousResultUrl || '需修改的生成图'}（公网url）`,
    `任务：${instruction || '按用户输入要求修改当前生成图。'}`,
  ].filter(Boolean).join('\n');
};

const buildProductReplaceInputRoleBlock = ({
  productUrls,
  referenceUrl,
  isCombination,
  logoRoleBlock,
}: {
  productUrls: string[];
  referenceUrl: string;
  isCombination: boolean;
  logoRoleBlock?: string;
}) => [
  '【输入图片角色】',
  isCombination
    ? `1. 产品素材图：${productUrls.join('、')}\n用途：目标产品组合的唯一外观依据。每张图代表一个需要保留独立身份的产品，必须保持各产品轮廓、结构比例、颜色、材质、纹理、Logo、标签、包装文字、图案和所有可见细节。\n组合替换说明：产品素材图表示同一组需要共同替换的产品。每个产品都要保持独立身份，并对应替换到当前参考图中的产品组合位置，不得遗漏、融合成新产品或自行新增组合关系。`
    : `1. 产品素材图：${productUrls.join('、')}\n用途：目标产品的唯一外观依据。必须保持产品轮廓、结构比例、颜色、材质、纹理、Logo、标签、包装文字、图案和所有可见细节。\n单品替换说明：产品素材图表示同一个产品，可以包含多角度、细节图或包装补充。所有产品素材共同用于确认同一产品外观，不按产品素材数量生成图片。`,
  `2. 当前替换参考图：${referenceUrl}\n用途：当前任务唯一参考图。只参考这一张图的构图、场景、人物、动作、光影、景深、版式、原产品位置和画面风格。`,
  logoRoleBlock || '',
].filter(Boolean).join('\n');

const buildProductReplaceLogoPromptBlock = ({
  logoUrl,
  logoPlacementGuideUrl,
  logoPlacementRatio,
}: {
  logoUrl?: string;
  logoPlacementGuideUrl?: string;
  logoPlacementRatio?: string;
}) => {
  if (!logoUrl || !logoPlacementGuideUrl) return '';
  return [
    `3. Logo 原图：${logoUrl}`,
    '用途：品牌 Logo 的唯一形状、颜色和细节依据。它不是产品素材，也不是替换参考图，不得被当作待替换产品。',
    `4. Logo 位置示意图：${logoPlacementGuideUrl}`,
    `用途：只用于判断 Logo 在最终图中的相对位置、面积、方向和比例，当前位置比例参考为 ${logoPlacementRatio || '相近比例'}。不得把示意图中的边框、辅助线、底色、选区框或标记生成到最终图里。`,
  ].join('\n');
};

const buildProductReplaceTaskBlock = () => [
  '1. 找到当前替换参考图中应被替换的原产品区域，将产品素材图中的目标产品自然替换进对应位置，并保持产品外观、细节、结构、比例、颜色、材质和 Logo 一致性准确。',
  '2. 移除参考图中的原产品、原品牌、原商标、原包装信息和原产品轮廓。',
  '3. 按 Logo 位置示意图，将 Logo 原图融合到最终画面的指定区域。',
  '4. 保持参考图中的场景、构图、光影、人物动作和整体商业视觉风格。',
  '5. 当前任务只使用当前这一张替换参考图，不得混入其它参考图的构图、产品、人物或场景。',
].join('\n');

const buildProductReplaceConstraintBlock = (hasLogoInputs: boolean) => [
  '1. 产品素材图是产品外观的最高优先级依据，不得重新设计、改色、改材质、改版型、改 Logo、改标签、改包装文字或改产品图案。',
  '2. 不得把参考图中原产品的品牌、结构、包装、标签、文字或图案套到目标产品上。',
  '3. 产品必须真实融入画面，透视、遮挡、接触阴影、材质反光、边缘融合和景深关系要自然，不能像简单贴图。',
  hasLogoInputs ? '4. Logo 必须植入最终图。若参考图中已有非产品旧 Logo、角标、水印或品牌标识，应先移除，再按 Logo 位置示意图放置上传 Logo。' : '',
  hasLogoInputs ? '5. Logo 位置示意图只作为位置参考，不得作为背景、风格图、水印图或最终画面内容。' : '',
  `${hasLogoInputs ? '6' : '4'}. 若产品准确性与参考图效果冲突，优先保证产品素材准确，其次保证画面自然融合。`,
].filter(Boolean).join('\n');

const buildProductReplacePrompt = ({
  productUrls,
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  logoPromptBlock,
  isCombination,
}: {
  productUrls: string[];
  referenceUrl: string;
  userPrompt: string;
  referenceStrength: string;
  textPolicy: string;
  aspectRatio: AspectRatio;
  batchIndex: number;
  batchCount: number;
  logoPromptBlock?: string;
  isCombination: boolean;
}) => [
  '【角色】\n你是电商视觉产品替换执行模型。目标是基于当前这一张替换参考图，生成一张完成产品替换、Logo 植入和画面融合的商业效果图。',
  buildProductReplaceInputRoleBlock({
    productUrls,
    referenceUrl,
    isCombination,
    logoRoleBlock: logoPromptBlock,
  }),
  '【任务】\n' + buildProductReplaceTaskBlock(),
  '【替换逻辑】\n' + (isCombination
    ? '将当前参考图中的原产品组合整体替换为上传的产品组合。保持各产品真实比例、独立外观和相对关系，并与参考图中的产品位置一一对应。不得遗漏任意上传产品。'
    : '将当前参考图中的原产品替换为产品素材图中的同一单品。若产品素材有多张，只用于补充同一产品的角度和细节，不拆分为多个结果。'),
  '【参考强度】\n' + buildProductReplaceStrengthConstraint(referenceStrength),
  '【文案处理】\n' + buildProductReplaceTextPolicyBlock(textPolicy),
  '【约束】\n' + buildProductReplaceConstraintBlock(Boolean(logoPromptBlock)),
  userPrompt ? `【用户补充要求】\n${userPrompt}` : '',
  `【输出要求】\n生成第 ${batchIndex}/${batchCount} 张，画面比例为 ${aspectRatio}。\n输出干净完整的商业效果图。画面自然、清晰、材质统一，避免噪点、伪影、畸变、破碎纹理、过度锐化和不自然贴图感。`,
].filter(Boolean).join('\n\n');

const buildSingleProductReplacePrompt = ({
  productUrls,
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  logoPromptBlock,
}: {
  productUrls: string[];
  referenceUrl: string;
  userPrompt: string;
  referenceStrength: string;
  textPolicy: string;
  aspectRatio: AspectRatio;
  batchIndex: number;
  batchCount: number;
  logoPromptBlock?: string;
}) => buildProductReplacePrompt({
  productUrls,
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  logoPromptBlock,
  isCombination: false,
});

const buildCombinationProductReplacePrompt = ({
  productUrls,
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  logoPromptBlock,
}: {
  productUrls: string[];
  referenceUrl: string;
  userPrompt: string;
  referenceStrength: string;
  textPolicy: string;
  aspectRatio: AspectRatio;
  batchIndex: number;
  batchCount: number;
  logoPromptBlock?: string;
}) => buildProductReplacePrompt({
  productUrls,
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  logoPromptBlock,
  isCombination: true,
});

const resolveProductReplaceReferenceAspectRatio = async (
  reference: ShellMaterialInput,
  config: ModuleConfig,
  publicBaseUrl: string,
  signal: AbortSignal,
) => {
  if (config.aspectRatio !== AspectRatio.AUTO) return config.aspectRatio;
  const supported = getSupportedAspectRatiosForModel(config.model).filter((ratio) => ratio !== AspectRatio.AUTO);
  let exact = getExactAspectRatioFromDimensions(reference.originalWidth, reference.originalHeight);
  if (!exact) {
    const referenceUrl = materialUrl(reference, publicBaseUrl);
    const dims = await getImageDimensionsFromUrl(referenceUrl).catch(() => null);
    exact = getExactAspectRatioFromDimensions(dims?.width, dims?.height);
  }
  return (resolveNearestSupportedAspectRatio(exact, supported, AspectRatio.AUTO) || AspectRatio.AUTO) as AspectRatio;
};

const buildEverythingReplaceLogoInputs = async ({
  input,
  referenceMaterial,
  referenceUrl,
  publicBaseUrl,
  referenceIndex,
}: {
  input: ShellGenerateInput;
  referenceMaterial: ShellMaterialInput;
  referenceUrl: string;
  publicBaseUrl: string;
  referenceIndex: number;
}) => {
  const logoMaterial = (input.materials.logo || [])[0];
  if (!logoMaterial) {
    return { imageUrls: [] as string[], promptBlock: '', logoPlacementGuideUrl: '', logoPlacementRatio: '' };
  }
  const logoUrl = materialUrl(logoMaterial, publicBaseUrl);
  if (!logoUrl) {
    return { imageUrls: [] as string[], promptBlock: '', logoPlacementGuideUrl: '', logoPlacementRatio: '' };
  }
  const logoRatio = logoMaterial.originalWidth && logoMaterial.originalHeight
    ? logoMaterial.originalWidth / Math.max(1, logoMaterial.originalHeight)
    : 2;
  const localLogoRecord = logoMaterial.localAssetId
    ? await loadShellDraftAsset(logoMaterial.localAssetId).catch(() => null)
    : null;
  const placement = logoMaterial.logoPlacement || createDefaultLogoPlacement({
    width: referenceMaterial.originalWidth || 1000,
    height: referenceMaterial.originalHeight || 1000,
    logoRatio,
  });
  const guide = await createEverythingReplaceLogoPlacementGuide({
    referenceUrl,
    logoUrl,
    logoBlob: localLogoRecord?.blob,
    placement,
    referenceWidth: referenceMaterial.originalWidth,
    referenceHeight: referenceMaterial.originalHeight,
    logoRatio,
  });
  const guideFile = new File(
    [guide.blob],
    `everything-replace-logo-placement-${referenceIndex + 1}.png`,
    { type: 'image/png' },
  );
  const uploaded = await uploadInternalAssetStream({
    module: input.module,
    file: guideFile,
    fileName: guideFile.name,
    signal: input.signal,
  });
  if (!uploaded.fileUrl) throw new Error('Logo位置示意图上传失败，请重新调整 Logo 位置后再生成。');
  const logoPlacementGuideUrl = uploaded.fileUrl;
  return {
    imageUrls: [logoUrl, logoPlacementGuideUrl],
    promptBlock: buildProductReplaceLogoPromptBlock({
      logoUrl,
      logoPlacementGuideUrl,
      logoPlacementRatio: guide.ratio,
    }),
    logoPlacementGuideUrl,
    logoPlacementRatio: guide.ratio,
  };
};

const runProductReplaceWorkflow = async (
  input: ShellGenerateInput,
  config: ModuleConfig,
  apiConfig: GlobalApiConfig,
  onItemCompleted?: (item: ShellWorkflowImageResult, index: number, total: number) => void,
): Promise<{ results: ShellWorkflowImageResult[]; creditsConsumed?: number }> => {
  const publicBaseUrl = input.publicBaseUrl || '';
  const productMaterials = input.materials.product || [];
  const referenceMaterials = input.materials.styleRef || [];
  const productUrls = productMaterials.map((item) => materialUrl(item, publicBaseUrl)).filter(Boolean);
  const referenceUrls = referenceMaterials.map((item) => materialUrl(item, publicBaseUrl)).filter(Boolean);
  if (productUrls.length === 0) throw new Error('请先上传待替换产品图。');
  if (referenceUrls.length === 0) throw new Error('请先上传替换参考图。');

  const replacementLogic = normalizeReplacementLogic(input.params.replacementLogic);
  const referenceStrength = normalizeProductReplaceStrength(input.params.firstImageColorMode);
  const textPolicy = normalizeProductReplaceTextPolicy(input.params.textPolicy);
  const isCombination = replacementLogic === 'combination_replace';
  const total = referenceUrls.length;
  let batchIndex = 0;
  const results = await Promise.all(referenceUrls.map((referenceUrl, referenceIndex) => {
    const referenceMaterial = referenceMaterials[referenceIndex];
    batchIndex += 1;
    const currentBatchIndex = batchIndex;
    if (isCombination) {
      return (async () => {
        const aspectRatio = await resolveProductReplaceReferenceAspectRatio(referenceMaterial, config, publicBaseUrl, input.signal);
        const logoInputs = await buildEverythingReplaceLogoInputs({
          input,
          referenceMaterial,
          referenceUrl,
          publicBaseUrl,
          referenceIndex,
        });
        const prompt = buildCombinationProductReplacePrompt({
          productUrls,
          referenceUrl,
          userPrompt: input.prompt.trim(),
          referenceStrength,
          textPolicy,
          aspectRatio,
          batchIndex: currentBatchIndex,
          batchCount: total,
          logoPromptBlock: logoInputs.promptBlock,
        });
        const generation = await processWithKieAi(
          [...productUrls, referenceUrl, ...logoInputs.imageUrls],
          apiConfig,
          { ...config, aspectRatio, targetLanguage: 'zh', removeWatermark: true, resolutionMode: 'original', targetWidth: 0, targetHeight: 0 },
          aspectRatio === AspectRatio.AUTO,
          input.signal,
          prompt,
          false,
          undefined,
          'main',
          {
            ...(input.taskMetadata || {}),
            subFeature: input.subFeature || 'product_replace',
            replacementLogic,
            firstImageColorMode: referenceStrength,
            textPolicy,
            skipPromptCleanupSuffix: true,
            batchIndex: currentBatchIndex,
            batchCount: total,
            referenceIndex: referenceIndex + 1,
            referenceCount: referenceUrls.length,
            logoPlacementGuideUrl: logoInputs.logoPlacementGuideUrl,
          },
          input.onJobCreated,
        );
        const item = await toProductReplaceResultItem(generation, prompt, config, aspectRatio, currentBatchIndex, total, referenceUrl, input.signal);
        onItemCompleted?.(item, currentBatchIndex, total);
        return item;
      })();
    }
    return (async () => {
        const aspectRatio = await resolveProductReplaceReferenceAspectRatio(referenceMaterial, config, publicBaseUrl, input.signal);
        const logoInputs = await buildEverythingReplaceLogoInputs({
          input,
          referenceMaterial,
          referenceUrl,
          publicBaseUrl,
          referenceIndex,
        });
        const prompt = buildSingleProductReplacePrompt({
          productUrls,
          referenceUrl,
          userPrompt: input.prompt.trim(),
          referenceStrength,
          textPolicy,
          aspectRatio,
          batchIndex: currentBatchIndex,
          batchCount: total,
          logoPromptBlock: logoInputs.promptBlock,
        });
        const generation = await processWithKieAi(
          [...productUrls, referenceUrl, ...logoInputs.imageUrls],
          apiConfig,
          { ...config, aspectRatio, targetLanguage: 'zh', removeWatermark: true, resolutionMode: 'original', targetWidth: 0, targetHeight: 0 },
          aspectRatio === AspectRatio.AUTO,
          input.signal,
          prompt,
          false,
          undefined,
          'main',
          {
            ...(input.taskMetadata || {}),
            subFeature: input.subFeature || 'product_replace',
            replacementLogic,
            firstImageColorMode: referenceStrength,
            textPolicy,
            skipPromptCleanupSuffix: true,
            batchIndex: currentBatchIndex,
            batchCount: total,
            productCount: productUrls.length,
            referenceIndex: referenceIndex + 1,
            referenceCount: referenceUrls.length,
            logoPlacementGuideUrl: logoInputs.logoPlacementGuideUrl,
          },
          input.onJobCreated,
        );
        const item = await toProductReplaceResultItem(generation, prompt, config, aspectRatio, currentBatchIndex, total, referenceUrl, input.signal);
        onItemCompleted?.(item, currentBatchIndex, total);
        return item;
    })();
  }));

  return {
    results,
    creditsConsumed: results.reduce((sum, item) => sum + (Number(item.creditsConsumed) || 0), 0) || undefined,
  };
};

const toProductReplaceResultItem = async (
  generation: KieAiResult,
  prompt: string,
  config: ModuleConfig,
  aspectRatio: AspectRatio,
  batchIndex: number,
  batchCount: number,
  sourceUrl: string,
  signal: AbortSignal,
): Promise<ShellWorkflowImageResult> => {
  if (generation.status !== 'success' || !generation.imageUrl) {
    if (generation.taskId) {
      return {
        imageUrl: '',
        prompt,
        taskId: generation.taskId,
        backendJobId: generation.backendJobId,
        model: getImageResultModelLabel(config),
        aspectRatio,
        sourceUrl,
        status: generation.status === 'generating' ? 'generating' : 'error',
        error: generation.message || `第 ${batchIndex}/${batchCount} 张产品替换失败`,
        message: generation.message,
        errorCode: generation.errorCode,
        batchIndex,
      };
    }
    throw new Error(generation.message || `第 ${batchIndex}/${batchCount} 张产品替换失败`);
  }
  const finalUrl = await maybeResizeAndPersistRetouchResult(
    generation.imageUrl,
    `everything-replace-${batchIndex}.png`,
    { ...config, aspectRatio, resolutionMode: 'original', targetWidth: 0, targetHeight: 0 },
    signal,
  );
  return {
    imageUrl: finalUrl,
    prompt,
    taskId: generation.taskId,
    backendJobId: generation.backendJobId,
    creditsConsumed: generation.creditsConsumed,
    model: getImageResultModelLabel(config),
    aspectRatio,
    sourceUrl,
    status: 'completed',
    batchIndex,
  };
};

const maybeResizeAndPersistRetouchResult = async (
  imageUrl: string,
  sourceName: string,
  config: ModuleConfig,
  signal: AbortSignal,
) => {
  let finalUrl = imageUrl;
  if (config.resolutionMode === 'custom' && (config.targetWidth > 0 || config.targetHeight > 0)) {
    try {
      const response = await fetch(imageUrl, { signal });
      const blob = await normalizeFetchedImageBlob(await response.blob(), imageUrl);
      let width = config.targetWidth;
      let height = config.targetHeight;
      if (width > 0 && height === 0) {
        const dims = await getImageDimensions(blob);
        height = Math.round(width / dims.ratio);
      } else if (height > 0 && width === 0) {
        const dims = await getImageDimensions(blob);
        width = Math.round(height * dims.ratio);
      }
      if (width > 0 && height > 0) {
        const resizedBlob = await resizeImage(blob, width, height, config.maxFileSize);
        finalUrl = await persistGeneratedAsset(resizedBlob, 'retouch', sourceName);
      }
    } catch (error) {
      console.warn('[MEIAO] shell retouch resize failed, keeping provider output', error);
    }
  }
  if (!finalUrl || finalUrl.startsWith('blob:')) {
    const response = await fetch(finalUrl || imageUrl, { signal });
    const blob = await normalizeFetchedImageBlob(await response.blob(), finalUrl || imageUrl);
    finalUrl = await persistGeneratedAsset(blob, 'retouch', sourceName);
  }
  return finalUrl;
};

export const runShellRetouchWorkflow = async (
  input: ShellGenerateInput,
  onItemCompleted?: (item: ShellWorkflowImageResult, index: number, total: number) => void,
): Promise<{ results: ShellWorkflowImageResult[]; creditsConsumed?: number }> => {
  const mode = getRetouchMode(input);
  const sourceMaterials = input.materials.product || [];
  const sourceUrls = sourceMaterials.map((item) => materialUrl(item, input.publicBaseUrl || '')).filter(Boolean);
  if (sourceUrls.length === 0) throw new Error(mode === 'product_replace' ? '请先上传待替换产品图。' : '请先上传产品素材，再启动产品精修。');

  storeActiveModuleContext(input.module);
  const apiConfig: GlobalApiConfig = {
    kieApiKey: '',
    concurrency: 1,
    workspacePreferences: input.params.__workspacePreferences ? JSON.parse(input.params.__workspacePreferences) : undefined,
  };
  const config = buildShellModuleConfig({
    ...input,
    params: {
      ...input.params,
      ratio: input.params.ratio || input.params.aspectRatio || 'auto',
      aspectRatio: input.params.aspectRatio || input.params.ratio || 'auto',
    },
  });
  if (mode === 'product_replace') {
    return runProductReplaceWorkflow(input, config, apiConfig, onItemCompleted);
  }
  const referenceUrl = firstMaterialUrl(input.materials.styleRef, input.publicBaseUrl || '', '精修参考图')
    || firstMaterialUrl(input.materials.texture, input.publicBaseUrl || '', '精修质感参考图')
    || '';
  const results: ShellWorkflowImageResult[] = [];

  for (let index = 0; index < sourceUrls.length; index += 1) {
    const sourceUrl = sourceUrls[index];
    const material = sourceMaterials[index];
    const analysis = await analyzeRetouchTask(sourceUrl, mode, apiConfig, referenceUrl || null, input.signal);
    if (analysis.status === 'error') throw new Error(analysis.message || '精修分析失败');
    const prompt = buildRetouchPrompt(sourceUrl, referenceUrl || null, analysis.description, mode, config.aspectRatio);
    const generation = await processWithKieAi(
      referenceUrl ? [sourceUrl, referenceUrl] : sourceUrl,
      apiConfig,
      {
        ...config,
        targetLanguage: 'zh',
        removeWatermark: true,
        resolutionMode: 'original',
        targetWidth: 0,
        targetHeight: 0,
      },
      config.aspectRatio === AspectRatio.AUTO,
      input.signal,
      prompt,
    );
    if (generation.status !== 'success' || !generation.imageUrl) {
      if (generation.taskId) {
        const pendingItem: ShellWorkflowImageResult = {
          imageUrl: '',
          prompt,
          taskId: generation.taskId,
          backendJobId: generation.backendJobId,
          model: getImageResultModelLabel(config),
          aspectRatio: config.aspectRatio,
          fileName: material?.fileName || `精修图片 ${index + 1}`,
          sourceUrl,
          status: generation.status === 'generating' ? 'generating' : 'error',
          error: generation.message || `第 ${index + 1} 张精修失败`,
          message: generation.message,
          errorCode: generation.errorCode,
        };
        results.push(pendingItem);
        onItemCompleted?.(pendingItem, index + 1, sourceUrls.length);
        continue;
      }
      throw new Error(generation.message || `第 ${index + 1} 张精修失败`);
    }
    const finalUrl = await maybeResizeAndPersistRetouchResult(
      generation.imageUrl,
      material?.fileName || `retouch-${index + 1}.png`,
      config,
      input.signal,
    );
    const item: ShellWorkflowImageResult = {
      imageUrl: finalUrl,
      prompt,
      taskId: generation.taskId,
      backendJobId: generation.backendJobId,
      creditsConsumed: generation.creditsConsumed,
      model: getImageResultModelLabel(config),
      aspectRatio: config.aspectRatio,
      fileName: material?.fileName || `精修图片 ${index + 1}`,
      sourceUrl,
      status: 'completed',
    };
    results.push(item);
    onItemCompleted?.(item, index + 1, sourceUrls.length);
  }

  return {
    results,
    creditsConsumed: results.reduce((sum, item) => sum + (Number(item.creditsConsumed) || 0), 0) || undefined,
  };
};

export const runShellVideoGeneration = async (input: ShellGenerateInput) => {
  storeActiveModuleContext(input.module);
  const publicBaseUrl = input.publicBaseUrl || '';
  const mode = normalizeDreaminaMode(firstParam(input.params, ['dreaminaMode', 'videoMode'], 'multimodal2video'));
  const accessMode = normalizeDreaminaAccessMode(
    mode,
    firstParam(input.params, ['modelVersion', 'videoAccessMode'], 'bytedance/seedance-2-fast'),
  );
  const productUrls = collectMaterialUrls(input.materials.product, publicBaseUrl);
  const sceneUrls = collectMaterialUrls(input.materials.scene, publicBaseUrl);
  const referenceVideoUrls = collectMaterialUrls(input.materials.referenceVideo, publicBaseUrl);
  const audioUrls = collectMaterialUrls(input.materials.audio, publicBaseUrl);
  const imageUrls = [...productUrls, ...sceneUrls];

  if (mode === 'frames2video' && imageUrls.length < 2) {
    throw new Error('首尾帧请至少上传 2 张图片素材，第一张作为首帧，第二张作为尾帧。');
  }
  if (mode === 'multiframe2video' && imageUrls.length < 2) {
    throw new Error('智能多帧请至少上传 2 张图片素材。');
  }
  if (mode === 'multimodal2video' && imageUrls.length + referenceVideoUrls.length < 1) {
    throw new Error('全能参考请至少上传 1 个图片或视频素材。');
  }
  const duration = normalizeDreaminaDuration(firstParam(input.params, ['duration'], mode === 'multiframe2video' ? '3秒' : '5秒'));
  const transitionCount = mode === 'multiframe2video' ? Math.max(0, imageUrls.length - 1) : 0;
  const transitionPrompts = mode === 'multiframe2video'
    ? normalizeDreaminaTransitionPrompts(String(input.params.transitionPrompts || input.params.transitionPrompt || ''), input.prompt.trim(), transitionCount)
    : String(input.params.transitionPrompts || input.params.transitionPrompt || input.prompt || '')
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  const transitionDurations = mode === 'multiframe2video'
    ? normalizeDreaminaTransitionDurations(String(input.params.transitionDurations || ''), duration, transitionCount)
    : String(input.params.transitionDurations || '')
      .split(/[,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  const isApiAccess = accessMode !== 'cli';

  const { job } = await createInternalJob({
    module: input.module,
    taskType: isApiAccess ? 'kie_seedance_video' : 'dreamina_video',
    provider: isApiAccess ? 'kie' : 'dreamina',
    payload: isApiAccess
      ? {
          mode,
          prompt: input.prompt.trim(),
          imageUrls,
          videoUrls: mode === 'multimodal2video' ? referenceVideoUrls : [],
          audioUrls: mode === 'multimodal2video' ? audioUrls : [],
          duration,
          aspectRatio: firstParam(input.params, ['ratio', 'aspectRatio'], '9:16'),
          resolution: normalizeSeedanceApiResolution(firstParam(input.params, ['videoResolution'], '720p')),
          generateAudio: parseSeedanceGenerateAudio(input.params),
          model: 'bytedance/seedance-2-fast',
          subFeature: input.subFeature,
        }
      : {
          mode,
          prompt: input.prompt.trim(),
          imageUrls,
          videoUrls: mode === 'multimodal2video' ? referenceVideoUrls : [],
          audioUrls: mode === 'multimodal2video' ? audioUrls : [],
          transitionPrompts,
          transitionDurations,
          duration,
          ratio: firstParam(input.params, ['ratio', 'aspectRatio'], '9:16'),
          modelVersion: 'seedance2.0fast_vip',
          subFeature: input.subFeature,
        },
    maxRetries: 0,
  });
  input.onJobCreated?.(job.id);

  try {
    const finalJob = await waitForInternalJob(job.id, input.signal, 3000, 0);
    if (finalJob.status === 'succeeded' && finalJob.result?.videoUrl) {
      const videoUrl = String(finalJob.result.videoUrl || '');
      return {
        imageUrl: videoUrl,
        videoUrl,
        taskId: String(finalJob.providerTaskId || finalJob.result?.providerTaskId || '').trim() || undefined,
        backendJobId: String(finalJob.id || job.id || '').trim() || undefined,
        status: 'success',
        prompt: input.prompt.trim(),
        creditsConsumed: Number.isFinite(Number(finalJob.result?.creditsConsumed)) ? Number(finalJob.result?.creditsConsumed) : undefined,
      };
    }
    if (finalJob.status === 'cancelled') {
      return {
        imageUrl: '',
        status: 'interrupted',
        message: finalJob.errorMessage || '任务已取消',
        taskId: String(finalJob.providerTaskId || finalJob.result?.providerTaskId || '').trim() || undefined,
        backendJobId: String(finalJob.id || job.id || '').trim() || undefined,
        prompt: input.prompt.trim(),
      };
    }
    return {
      imageUrl: '',
      status: 'error',
      message: finalJob.errorMessage || '即梦视频任务失败',
      errorCode: finalJob.errorCode,
      taskId: String(finalJob.providerTaskId || finalJob.result?.providerTaskId || '').trim() || undefined,
      backendJobId: String(finalJob.id || job.id || '').trim() || undefined,
      prompt: input.prompt.trim(),
    };
  } catch (error: any) {
    if (error?.message === 'INTERRUPTED') {
      void cancelInternalJob(job.id).catch(() => null);
      return { imageUrl: '', status: 'interrupted', message: '任务已取消', prompt: input.prompt.trim() };
    }
    return {
      imageUrl: '',
      status: 'generating',
      taskId: String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
      backendJobId: job.id,
      message: error?.message || '任务已提交云端，结果待同步',
      prompt: input.prompt.trim(),
    };
  }
};
