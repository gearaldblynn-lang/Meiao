// @ts-nocheck
import type {
  AppModule,
  AspectRatio,
  BuyerShowPersistentState,
  BuyerShowSubMode,
  GlobalApiConfig,
  ModuleConfig,
  OneClickPersistentState,
  OneClickReferenceDimension,
  OneClickReferencePresetLibrary,
  RetouchPersistentState,
  TranslationModuleConfigs,
  TranslationPersistentState,
  VideoPersistentState,
  VideoSubMode,
  WorkspacePreferences,
  XhsCoverPersistentState,
} from '../types.ts';
import {
  createDefaultTranslationConfigs,
  getLegacyTranslationModuleConfig,
  migrateLegacyTranslationConfigs,
} from '../modules/Translation/translationConfigUtils.mjs';
import { normalizeRestoredXhsCoverProjects, normalizeRestoredXhsCoverTasks } from '../modules/XhsCover/xhsCoverUtils.mjs';
import { hasReusableTaskAsset } from './cloudAssetState.mjs';
import { normalizeImageModel } from './modelCapabilities.mjs';
import { normalizeShellDraftState } from './shellDraftState.ts';
import type { ShellDraftState } from './shellDraftState.ts';

export const PERSISTENCE_KEY = 'AIGC_APP_STATE_V1';
const MAX_LOCAL_PERSISTED_STATE_BYTES = 5 * 1024 * 1024;
export const getPersistedAppStateKey = (userId?: string | null) => {
  const scope = String(userId || '').trim();
  return scope ? `${PERSISTENCE_KEY}:${encodeURIComponent(scope)}` : PERSISTENCE_KEY;
};
const DEFAULT_ACTIVE_MODULE = 'one_click' as AppModule;
const ASPECT_RATIO_AUTO = 'auto' as AspectRatio;
const ASPECT_RATIO_SQUARE = '1:1' as AspectRatio;
const ASPECT_RATIO_3_4 = '3:4' as AspectRatio;
const ASPECT_RATIO_9_16 = '9:16' as AspectRatio;
const BUYER_SHOW_SUBMODE_INTEGRATED = 'integrated' as BuyerShowSubMode;
const VIDEO_SUBMODE_STORYBOARD = 'storyboard' as VideoSubMode;
type OneClickSubModeValue = 'first_image' | 'main_image' | 'detail_page' | 'sku';
const ONE_CLICK_SUBMODE_FIRST_IMAGE = 'first_image' as OneClickSubModeValue;
const ONE_CLICK_SUBMODE_MAIN_IMAGE = 'main_image' as OneClickSubModeValue;
const ONE_CLICK_SUBMODE_DETAIL_PAGE = 'detail_page' as OneClickSubModeValue;
const ONE_CLICK_SUBMODE_SKU = 'sku' as OneClickSubModeValue;
const VALID_ONE_CLICK_REFERENCE_DIMENSIONS = new Set<OneClickReferenceDimension>([
  'visual_style',
  'typography',
  'color_palette',
  'layout',
  'copy_content',
]);

export interface PersistedAppState {
  activeModule: AppModule;
  apiConfig: GlobalApiConfig;
  moduleConfig: ModuleConfig;
  translationConfigs: TranslationModuleConfigs;
  translationMemory: TranslationPersistentState;
  oneClickMemory: OneClickPersistentState;
  retouchMemory: RetouchPersistentState;
  buyerShowMemory: BuyerShowPersistentState;
  videoMemory: VideoPersistentState;
  xhsCoverMemory: XhsCoverPersistentState;
  shellDraft: ShellDraftState;
  shellProjects: any[];
}

let persistedStateCache: { raw: string; state: Partial<PersistedAppState> } | null = null;

const getStorageByteLength = (value: string) =>
  typeof Blob !== 'undefined' ? new Blob([value]).size : value.length;

const readBoundedPersistedStateStorage = (key: string) => {
  const raw = localStorage.getItem(key) || '';
  if (!raw) return '';
  if (getStorageByteLength(raw) <= MAX_LOCAL_PERSISTED_STATE_BYTES) return raw;
  localStorage.removeItem(key);
  persistedStateCache = null;
  console.warn(`[MEIAO] ignored oversized persisted localStorage item ${key}`);
  return '';
};

export const createDefaultWorkspacePreferences = (): WorkspacePreferences => ({
  compressImagesBeforeUpload: true,
  playSoundAfterGeneration: false,
  showGenerationProgress: true,
});

export const getWorkspacePreferences = (config?: Partial<GlobalApiConfig> | null): WorkspacePreferences => ({
  ...createDefaultWorkspacePreferences(),
  ...(config?.workspacePreferences || {}),
});

export const createDefaultApiConfig = (): GlobalApiConfig => ({
  kieApiKey: '',
  concurrency: 5,
  workspacePreferences: createDefaultWorkspacePreferences(),
});

const sanitizeApiConfig = (config?: Partial<GlobalApiConfig>): GlobalApiConfig => ({
  kieApiKey: '',
  concurrency: typeof config?.concurrency === 'number' && config.concurrency > 0 ? config.concurrency : 5,
  workspacePreferences: {
    ...createDefaultWorkspacePreferences(),
    ...(config?.workspacePreferences || {}),
  },
});

export const createDefaultModuleConfig = (): ModuleConfig => ({
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: ASPECT_RATIO_AUTO,
  quality: '1k',
  model: 'gpt-image-2',
  resolutionMode: 'custom',
  targetWidth: 1200,
  targetHeight: 1200,
  maxFileSize: 2.0,
});

export const createDefaultTranslationState = (): TranslationPersistentState => ({
  main: { files: [], isProcessing: false },
  detail: { files: [], isProcessing: false },
  removeText: { files: [], isProcessing: false },
});

export const createDefaultTranslationConfigState = (): TranslationModuleConfigs =>
  createDefaultTranslationConfigs() as TranslationModuleConfigs;

export const createDefaultOneClickState = (): OneClickPersistentState => ({
  referencePresets: {
    presets: [],
  },
  firstImage: {
    productImages: [],
    logoImage: null,
    uploadedLogoUrl: null,
    styleImage: null,
    designReferences: [],
    uploadedDesignReferenceUrls: [],
    referenceDimensions: ['visual_style', 'color_palette', 'layout'],
    referenceAnalysis: {
      status: 'idle',
      summary: '',
      analyzedAt: null,
    },
    schemes: [],
    config: {
      description: '',
      platformType: 'domestic',
      platform: '淘宝',
      language: '中文',
      count: 1,
      aspectRatio: ASPECT_RATIO_SQUARE,
      firstImageColorMode: 'product_adaptive',
      quality: '1k',
      model: 'gpt-image-2',
      styleStrength: 'medium',
      resolutionMode: 'custom',
      targetWidth: 800,
      targetHeight: 800,
      maxFileSize: 2.0,
    },
    lastStyleUrl: null,
    uploadedProductUrls: [],
    directions: [],
    projects: [],
    activeProjectId: null,
  },
  mainImage: {
    productImages: [],
    logoImage: null,
    uploadedLogoUrl: null,
    styleImage: null,
    designReferences: [],
    uploadedDesignReferenceUrls: [],
    referenceDimensions: ['visual_style', 'color_palette', 'layout'],
    referenceAnalysis: {
      status: 'idle',
      summary: '',
      analyzedAt: null,
    },
    schemes: [],
    config: {
      description: '',
      platformType: 'domestic',
      platform: '淘宝',
      language: '中文',
      count: 3,
      aspectRatio: ASPECT_RATIO_SQUARE,
      quality: '1k',
      model: 'gpt-image-2',
      styleStrength: 'medium',
      resolutionMode: 'custom',
      targetWidth: 800,
      targetHeight: 800,
      maxFileSize: 2.0,
    },
    lastStyleUrl: null,
    uploadedProductUrls: [],
    directions: [],
    projects: [],
    activeProjectId: null,
  },
    detailPage: {
    productImages: [],
    logoImage: null,
    uploadedLogoUrl: null,
    styleImage: null,
    designReferences: [],
    uploadedDesignReferenceUrls: [],
    referenceDimensions: ['visual_style', 'color_palette', 'layout'],
    referenceAnalysis: {
      status: 'idle',
      summary: '',
      analyzedAt: null,
    },
    schemes: [],
      config: {
        description: '',
        platformType: 'domestic',
        platform: '淘宝',
        language: '中文',
        count: 7,
        aspectRatio: ASPECT_RATIO_3_4,
        detailGenerationMode: 'AI直出',
        detailColorMode: 'product_adaptive',
        quality: '1k',
        model: 'gpt-image-2',
        styleStrength: 'medium',
        resolutionMode: 'custom',
      targetWidth: 750,
      targetHeight: 0,
      maxFileSize: 2.0,
    },
    lastStyleUrl: null,
    uploadedProductUrls: [],
    directions: [],
    projects: [],
    activeProjectId: null,
  },
  sku: {
    images: [],
    designReferences: [],
    uploadedDesignReferenceUrls: [],
    referenceDimensions: ['visual_style', 'typography', 'color_palette', 'layout'],
    referenceAnalysis: {
      status: 'idle',
      summary: '',
      analyzedAt: null,
    },
    schemes: [],
    config: {
      productInfo: '',
      language: '中文',
      count: 1,
      combinations: [{ id: 'combo_1', sceneDescription: '', skuCopyText: '' }],
      aspectRatio: ASPECT_RATIO_SQUARE,
      quality: '1k',
      model: 'gpt-image-2',
      styleStrength: 'medium',
      resolutionMode: 'custom',
      targetWidth: 800,
      targetHeight: 800,
      maxFileSize: 2.0,
    },
    firstSkuResultUrl: null,
    uploadedProductUrls: [],
    lastStyleUrl: null,
    projects: [],
    activeProjectId: null,
  },
});

const normalizeTimestamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const normalizeReferenceDimensions = (items: unknown): OneClickReferenceDimension[] =>
  Array.isArray(items)
    ? items.filter((item): item is OneClickReferenceDimension =>
        typeof item === 'string' && VALID_ONE_CLICK_REFERENCE_DIMENSIONS.has(item as OneClickReferenceDimension)
      )
    : [];

const normalizeReferencePresets = (source: unknown): OneClickReferencePresetLibrary => {
  const now = Date.now();
  const raw = source && typeof source === 'object' ? source as any : {};

  const normalizePresetBase = (item: any, fallbackName: string, fallbackSubMode: OneClickSubModeValue) => {
    const createdAt = normalizeTimestamp(item?.createdAt, now);
    const referenceImageUrls = Array.isArray(item?.referenceImageUrls)
      ? item.referenceImageUrls.filter((value: unknown): value is string => typeof value === 'string' && !!value.trim()).map((value: string) => value.trim())
      : [];
    const coverImageUrl = typeof item?.coverImageUrl === 'string' && item.coverImageUrl.trim()
      ? item.coverImageUrl.trim()
      : referenceImageUrls[0] || '';
    const summary = typeof item?.summary === 'string' && item.summary.trim()
      ? item.summary.trim()
      : typeof item?.detail === 'string' && item.detail.trim()
        ? item.detail.trim()
        : fallbackName;
    const detail = typeof item?.detail === 'string' && item.detail.trim()
      ? item.detail.trim()
      : summary;
    const subMode = item?.subMode === ONE_CLICK_SUBMODE_FIRST_IMAGE
      || item?.subMode === ONE_CLICK_SUBMODE_MAIN_IMAGE
      || item?.subMode === ONE_CLICK_SUBMODE_DETAIL_PAGE
      || item?.subMode === ONE_CLICK_SUBMODE_SKU
      ? item.subMode
      : fallbackSubMode;

    return typeof item?.id === 'string' && item.id.trim()
      ? {
          id: item.id.trim(),
          name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : fallbackName,
          subMode,
          coverImageUrl,
          referenceImageUrls,
          summary,
          detail,
          referenceDimensions: normalizeReferenceDimensions(item?.referenceDimensions),
          tags: Array.isArray(item?.tags)
            ? item.tags.filter((value: unknown): value is string => typeof value === 'string' && !!value.trim()).map((value: string) => value.trim())
            : [],
          ...(typeof item?.assetId === 'string' && item.assetId.trim() ? { assetId: item.assetId.trim() } : {}),
          createdAt,
          updatedAt: normalizeTimestamp(item?.updatedAt, createdAt),
        }
      : null;
  };

  const unifiedPresets = Array.isArray(raw.presets)
    ? raw.presets
        .map((item: any) => normalizePresetBase(item, '未命名预设', ONE_CLICK_SUBMODE_MAIN_IMAGE))
        .filter(Boolean)
    : null;

  if (unifiedPresets) {
    return { presets: unifiedPresets };
  }

  const textPresets = Array.isArray(raw.textPresets)
    ? raw.textPresets
        .filter((item: any) => typeof item?.id === 'string' && item.id.trim() && typeof item?.summary === 'string' && item.summary.trim())
        .map((item: any) => normalizePresetBase({
          ...item,
          subMode: item.sourceSubMode === ONE_CLICK_SUBMODE_DETAIL_PAGE ? ONE_CLICK_SUBMODE_DETAIL_PAGE : ONE_CLICK_SUBMODE_MAIN_IMAGE,
          coverImageUrl: '',
          referenceImageUrls: [],
          summary: item.summary,
          detail: item.summary,
          referenceDimensions: item.referenceDimensions,
        }, '未命名文字预设', ONE_CLICK_SUBMODE_MAIN_IMAGE))
        .filter(Boolean)
    : [];

  const normalizeImagePresets = (items: unknown, sourceSubMode: typeof ONE_CLICK_SUBMODE_FIRST_IMAGE | typeof ONE_CLICK_SUBMODE_SKU) =>
    Array.isArray(items)
      ? items
          .filter((item: any) => typeof item?.id === 'string' && item.id.trim() && typeof item?.imageUrl === 'string' && item.imageUrl.trim())
          .map((item: any) => {
            const fallbackName = sourceSubMode === ONE_CLICK_SUBMODE_FIRST_IMAGE ? '未命名首图参考' : '未命名SKU参考';
            return normalizePresetBase({
              ...item,
              subMode: sourceSubMode,
              coverImageUrl: item.imageUrl,
              referenceImageUrls: [item.imageUrl],
              summary: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : fallbackName,
              detail: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : fallbackName,
            }, fallbackName, sourceSubMode);
          })
          .filter(Boolean)
      : [];

  return {
    presets: [
      ...textPresets,
      ...normalizeImagePresets(raw.firstImageImagePresets, ONE_CLICK_SUBMODE_FIRST_IMAGE),
      ...normalizeImagePresets(raw.skuImagePresets, ONE_CLICK_SUBMODE_SKU),
    ],
  };
};

export const createDefaultRetouchState = (): RetouchPersistentState => ({
  tasks: [],
  pendingFiles: [],
  referenceImage: null,
  uploadedReferenceUrl: null,
  mode: 'white_bg',
  aspectRatio: ASPECT_RATIO_AUTO,
  quality: '1k',
  model: 'gpt-image-2',
  resolutionMode: 'original',
  targetWidth: 0,
  targetHeight: 0,
});

export const createDefaultBuyerShowState = (): BuyerShowPersistentState => ({
  subMode: BUYER_SHOW_SUBMODE_INTEGRATED,
  productImages: [],
  uploadedProductUrls: [],
  referenceImage: null,
  uploadedReferenceUrl: null,
  referenceStrength: 'medium',
  productName: '',
  productFeatures: '',
  userRequirement: '',
  targetCountry: '美国',
  customCountry: '',
  includeModel: true,
  aspectRatio: ASPECT_RATIO_3_4,
  quality: '1k',
  model: 'gpt-image-2',
  imageCount: 3,
  setCount: 1,
  sets: [],
  tasks: [],
  evaluationText: '',
  pureEvaluations: [],
  firstImageConfirmed: false,
  isAnalyzing: false,
  isGenerating: false,
});

export const createDefaultVideoState = (): VideoPersistentState => ({
  // subMode: VideoSubMode.STORYBOARD
  subMode: VIDEO_SUBMODE_STORYBOARD,
  config: {
    duration: '15',
    aspectRatio: 'landscape',
    promptMode: 'ai',
    script: '',
    scenes: [],
    productInfo: '',
    requirements: '',
    targetCountry: '美国',
    customCountry: '',
    referenceVideoUrl: '',
    videoCount: 1,
    targetLanguage: '',
    sellingPoints: '',
    logicInfo: '',
  },
  productImages: [],
  uploadedProductUrls: [],
  referenceVideoFile: null,
  uploadedReferenceVideoUrl: '',
  tasks: [],
  diagnosis: {
    platform: 'tiktok',
    accessMode: 'spider_api',
    url: '',
    analysisItems: ['video_basic', 'video_metrics', 'author_profile'],
    analysisModel: '',
    probe: {
      status: 'idle',
      sources: [],
      fields: [],
      raw: null,
      normalized: null,
      missingCriticalFields: [],
      error: '',
      completedAt: null,
    },
    report: {
      status: 'idle',
      summary: '',
      evidence: [],
      inferences: [],
      actions: [],
    },
    aiAnalysis: {
      status: 'idle',
      summary: '',
      overallRisk: 'unknown',
      sections: [],
      topActions: [],
      error: '',
      completedAt: null,
    },
  },
  veoProjects: [],
  veoReferenceImages: [],
  isAnalyzing: false,
  isGenerating: false,
  storyboard: {
    config: {
      productImages: [],
      uploadedProductUrls: [],
      productInfo: '',
      videoGenerationMode: 'original',
      scriptLogic: '',
      scriptPreset: 'custom',
      referenceVideoFile: null,
      uploadedReferenceVideoUrl: '',
      viralVariationCount: 3,
      viralVariationStrength: '10',
      viralCustomVariationStrength: '',
      reservedVideoApiProvider: '',
      aspectRatio: ASPECT_RATIO_9_16 as VideoPersistentState['storyboard']['config']['aspectRatio'],
      duration: '15s',
      shotCount: 9,
      actorType: 'no_real_face',
      projectCount: 1,
      scenes: [''],
      countryLanguage: '中国/中文',
      generateWhiteBg: false,
      model: 'gpt-image-2',
      quality: '2k',
      generationMode: 'single_image',
    },
    projects: [],
    downloadingProjectId: null,
  },
});

export const createDefaultXhsCoverState = (): XhsCoverPersistentState => ({
  productImages: [],
  uploadedProductUrls: [],
  styleReferenceImage: null,
  uploadedStyleReferenceUrl: null,
  title: '',
  subtitle: '',
  selectedStyleIds: ['workplace_big_text', 'yellow_pink_banner', 'sticker_energy'],
  fontStyle: 'variety',
  aspectRatio: '3:4',
  quality: '1k',
  model: 'gpt-image-2',
  decoration: '',
  extraRequirement: '',
  projects: [],
  activeProjectId: null,
  tasks: [],
  isGenerating: false,
});

const cleanState = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof File || obj instanceof Blob) return null;
  if (Array.isArray(obj)) return obj.map(cleanState);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    cleaned[key] = cleanState(value);
  }
  return cleaned;
};

const normalizeFileItemList = (items: unknown): unknown => {
  if (!Array.isArray(items)) return items;

  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const typedItem = item as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...typedItem };

    if (!(typedItem.file instanceof File)) {
      normalized.file = null;
    }

    if (!(typedItem.resultBlob instanceof Blob)) {
      normalized.resultBlob = undefined;
    }

    return normalized;
  });
};

const normalizeFileArray = (items: unknown): File[] => {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is File => item instanceof File);
};

const normalizeNullableFile = (item: unknown): File | null => {
  return item instanceof File ? item : null;
};

const normalizeStringArray = (items: unknown): string[] => {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const normalizeOneClickReferenceItems = (items: unknown) => {
  if (!Array.isArray(items)) return [];
  return items.map((item: any) => ({
    ...item,
    file: item?.file instanceof File ? item.file : null,
    uploadedUrl: typeof item?.uploadedUrl === 'string' ? item.uploadedUrl : null,
  }));
};

const ONE_CLICK_SUBFEATURES: Record<string, string> = {
  首图: 'first_image',
  主图: 'main_image',
  详情页: 'detail_page',
  SKU: 'sku',
};

const normalizeOneClickSubFeature = (value: unknown) => {
  const raw = String(value || '').trim();
  return ONE_CLICK_SUBFEATURES[raw] || raw;
};

const inferOneClickSchemeSubFeature = (scheme: any) => {
  const prompt = String(scheme?.prompt || scheme?.originalContent || scheme?.editedContent || scheme?.title || '').trim();
  const raw = normalizeOneClickSubFeature(
    scheme?.subFeature
    || scheme?.subMode
    || scheme?.mode
    || scheme?.taskType
    || (prompt.includes('详情') ? 'detail_page' : prompt.includes('主图') ? 'main_image' : prompt.includes('SKU') ? 'sku' : prompt.includes('首图') ? 'first_image' : '')
  );
  if (['first_image', 'main_image', 'detail_page', 'sku'].includes(raw)) return raw;
  return 'legacy_unassigned';
};

const normalizeOneClickProjectMeta = (project: any, fallbackName: string, index: number) => {
  const createdAt = normalizeTimestamp(project?.createdAt, Date.now());
  return {
    id: typeof project?.id === 'string' && project.id.trim() ? project.id : `${fallbackName}_${createdAt}_${index}`,
    name: typeof project?.name === 'string' && project.name.trim() ? project.name : `${fallbackName}项目 ${index + 1}`,
    createdAt,
    updatedAt: normalizeTimestamp(project?.updatedAt, createdAt),
    isDraft: project?.isDraft === true,
  };
};

const normalizeOneClickWorkspaceProjects = (
  projects: unknown,
  defaults: OneClickPersistentState['firstImage'],
  fallbackName: string,
) => {
  if (!Array.isArray(projects)) return [];
  return projects.flatMap((project: any, index) => {
    const baseProject = {
      ...defaults,
      ...normalizeOneClickProjectMeta(project, fallbackName, index),
      ...project,
      config: normalizeModelField((project?.config || defaults.config) as any),
      productImages: normalizeFileArray(project?.productImages),
      logoImage: normalizeNullableFile(project?.logoImage),
      styleImage: normalizeNullableFile(project?.styleImage),
      designReferences: normalizeOneClickReferenceItems(project?.designReferences),
      uploadedDesignReferenceUrls: normalizeStringArray(project?.uploadedDesignReferenceUrls),
      referenceDimensions: Array.isArray(project?.referenceDimensions)
        ? project.referenceDimensions.filter((item: any) => typeof item === 'string')
        : defaults.referenceDimensions,
      referenceAnalysis: {
        ...defaults.referenceAnalysis,
        ...(project?.referenceAnalysis || {}),
      },
      uploadedProductUrls: normalizeStringArray(project?.uploadedProductUrls),
      uploadedLogoUrl: typeof project?.uploadedLogoUrl === 'string' ? project.uploadedLogoUrl : null,
      lastStyleUrl: typeof project?.lastStyleUrl === 'string' ? project.lastStyleUrl : null,
      directions: Array.isArray(project?.directions) ? project.directions.filter((item: any) => typeof item === 'string') : [],
    };
    const schemes = Array.isArray(project?.schemes) ? project.schemes.map((scheme: any) => ({ ...scheme })) : [];
    if (schemes.length === 0) {
      return [{ ...baseProject, schemes }];
    }
    const groups = new Map<string, typeof schemes>();
    schemes.forEach((scheme: any) => {
      const subFeature = inferOneClickSchemeSubFeature(scheme);
      const bucket = groups.get(subFeature) || [];
      bucket.push(scheme);
      groups.set(subFeature, bucket);
    });
    if (groups.size <= 1) {
      return [{ ...baseProject, schemes }];
    }
    return Array.from(groups.entries()).map(([subFeature, groupedSchemes], groupIndex) => ({
      ...baseProject,
      id: `${baseProject.id}-${subFeature}`,
      name: `${baseProject.name} · ${subFeature === 'first_image' ? '首图' : subFeature === 'main_image' ? '主图' : subFeature === 'detail_page' ? '详情页' : subFeature === 'sku' ? 'SKU' : `分组${groupIndex + 1}`}`,
      schemes: groupedSchemes,
    }));
  });
};

const normalizeSkuWorkspaceProjects = (
  projects: unknown,
  defaults: OneClickPersistentState['sku'],
) => {
  if (!Array.isArray(projects)) return [];
  return projects.map((project: any, index) => ({
    ...defaults,
    ...normalizeOneClickProjectMeta(project, 'SKU', index),
    ...project,
    config: {
      ...defaults.config,
      ...normalizeModelField((project?.config || defaults.config) as any),
      ...(project?.config || {}),
      combinations: Array.isArray(project?.config?.combinations)
        ? project.config.combinations.map((item: any) => ({ ...item }))
        : defaults.config.combinations,
    },
    images: Array.isArray(project?.images)
      ? project.images.map((img: any) => ({
          ...img,
          file: img?.file instanceof File ? img.file : null,
        }))
      : [],
    designReferences: normalizeOneClickReferenceItems(project?.designReferences),
    uploadedDesignReferenceUrls: normalizeStringArray(project?.uploadedDesignReferenceUrls),
    referenceDimensions: Array.isArray(project?.referenceDimensions)
      ? project.referenceDimensions.filter((item: any) => typeof item === 'string')
      : defaults.referenceDimensions,
    referenceAnalysis: {
      ...defaults.referenceAnalysis,
      ...(project?.referenceAnalysis || {}),
    },
    schemes: Array.isArray(project?.schemes) ? project.schemes.map((scheme: any) => ({ ...scheme })) : [],
    firstSkuResultUrl: typeof project?.firstSkuResultUrl === 'string' ? project.firstSkuResultUrl : null,
    uploadedProductUrls: normalizeStringArray(project?.uploadedProductUrls),
    lastStyleUrl: typeof project?.lastStyleUrl === 'string' ? project.lastStyleUrl : null,
  }));
};

const normalizeVideoStoryboardConfig = (
  config: any,
  defaults: VideoPersistentState['storyboard']['config']
): VideoPersistentState['storyboard']['config'] => ({
  ...defaults,
  ...(config || {}),
  ...normalizeModelField(config as any),
  productImages: normalizeFileArray(config?.productImages),
  uploadedProductUrls: normalizeStringArray(config?.uploadedProductUrls),
  referenceVideoFile: normalizeNullableFile(config?.referenceVideoFile),
  uploadedReferenceVideoUrl: typeof config?.uploadedReferenceVideoUrl === 'string' ? config.uploadedReferenceVideoUrl : '',
  videoGenerationMode: config?.videoGenerationMode === 'viral_split' ? 'viral_split' : 'original',
  viralVariationCount: Number.isFinite(config?.viralVariationCount) ? Math.max(1, Number(config.viralVariationCount)) : defaults.viralVariationCount,
  viralVariationStrength: config?.viralVariationStrength === '5'
    || config?.viralVariationStrength === '10'
    || config?.viralVariationStrength === '20'
    || config?.viralVariationStrength === 'custom'
    ? config.viralVariationStrength
    : defaults.viralVariationStrength,
  viralCustomVariationStrength: typeof config?.viralCustomVariationStrength === 'string'
    ? config.viralCustomVariationStrength
    : defaults.viralCustomVariationStrength,
  reservedVideoApiProvider: typeof config?.reservedVideoApiProvider === 'string'
    ? config.reservedVideoApiProvider
    : defaults.reservedVideoApiProvider,
});

const normalizeModelField = <T extends Record<string, unknown> | undefined>(value: T): T => {
  if (!value || typeof value !== 'object' || !('model' in value)) return value;
  return {
    ...value,
    model: normalizeImageModel(String(value.model || '')),
  };
};

const normalizeRetouchTasks = (tasks: unknown) => {
  if (!Array.isArray(tasks)) return [];

  return tasks.filter((task) => {
    if (!task || typeof task !== 'object') return false;
    return hasReusableTaskAsset(task as Record<string, unknown>);
  }).map((task) => {
    const typedTask = task as Record<string, unknown>;
    return {
      ...typedTask,
      file: typedTask.file instanceof File ? typedTask.file : null,
      fileName: typeof typedTask.fileName === 'string'
        ? typedTask.fileName
        : typedTask.file instanceof File
          ? typedTask.file.name
          : typeof typedTask.relativePath === 'string'
            ? typedTask.relativePath
            : '',
      resultBlob: typedTask.resultBlob instanceof Blob ? typedTask.resultBlob : undefined,
    };
  });
};

export const normalizeLoadedPersistedAppState = (saved: Partial<PersistedAppState>): Partial<PersistedAppState> => {
  const translationConfigs = migrateLegacyTranslationConfigs(saved.moduleConfig, saved.translationConfigs);
  const defaultOneClickState = createDefaultOneClickState();
  const defaultVideoState = createDefaultVideoState();
  const normalizeOneClickActiveProjectId = (activeProjectId: unknown, projects: Array<{ id: string }>) =>
    typeof activeProjectId === 'string' && projects.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : null;

  return {
    ...saved,
    shellDraft: normalizeShellDraftState(saved.shellDraft),
    shellProjects: Array.isArray(saved.shellProjects) ? saved.shellProjects : [],
    translationConfigs,
    moduleConfig: normalizeModelField(getLegacyTranslationModuleConfig(translationConfigs)),
    translationMemory: saved.translationMemory
      ? {
          main: {
            ...saved.translationMemory.main,
            files: normalizeFileItemList(saved.translationMemory.main?.files) as any,
          },
          detail: {
            ...saved.translationMemory.detail,
            files: normalizeFileItemList(saved.translationMemory.detail?.files) as any,
          },
          removeText: {
            ...saved.translationMemory.removeText,
            files: normalizeFileItemList(saved.translationMemory.removeText?.files) as any,
          },
        }
      : undefined,
    oneClickMemory: saved.oneClickMemory
      ? {
          referencePresets: normalizeReferencePresets(saved.oneClickMemory.referencePresets),
          firstImage: (() => {
            const source = saved.oneClickMemory?.firstImage || defaultOneClickState.firstImage;
            const projects = normalizeOneClickWorkspaceProjects(source.projects, defaultOneClickState.firstImage, '首图');
            return {
              ...source,
              config: {
                ...normalizeModelField(source.config as any),
                firstImageColorMode: source.config?.firstImageColorMode === 'reference_locked' ? 'reference_locked' : 'product_adaptive',
              },
              productImages: normalizeFileArray(source.productImages),
              logoImage: normalizeNullableFile(source.logoImage),
              styleImage: normalizeNullableFile(source.styleImage),
              designReferences: normalizeOneClickReferenceItems(source.designReferences),
              uploadedDesignReferenceUrls: normalizeStringArray(source.uploadedDesignReferenceUrls),
              referenceDimensions: Array.isArray(source.referenceDimensions)
                ? source.referenceDimensions.filter((item: any) => typeof item === 'string')
                : defaultOneClickState.firstImage.referenceDimensions,
              referenceAnalysis: {
                ...defaultOneClickState.firstImage.referenceAnalysis,
                ...(source.referenceAnalysis || {}),
              },
              schemes: Array.isArray(source.schemes) ? source.schemes.map((scheme: any) => ({ ...scheme })) : [],
              uploadedProductUrls: normalizeStringArray(source.uploadedProductUrls),
              uploadedLogoUrl: typeof source.uploadedLogoUrl === 'string'
                ? source.uploadedLogoUrl
                : null,
              lastStyleUrl: typeof source.lastStyleUrl === 'string'
                ? source.lastStyleUrl
                : null,
              projects,
              activeProjectId: normalizeOneClickActiveProjectId(source.activeProjectId, projects),
            };
          })(),
          mainImage: (() => {
            const source = saved.oneClickMemory.mainImage || defaultOneClickState.mainImage;
            const projects = normalizeOneClickWorkspaceProjects(source.projects, defaultOneClickState.mainImage, '主图');
            return {
              ...source,
              config: {
                ...defaultOneClickState.detailPage.config,
                ...normalizeModelField(source.config as any),
                detailGenerationMode: source.config?.detailGenerationMode === '套图复刻' ? '套图复刻' : 'AI直出',
                detailColorMode: source.config?.detailColorMode === 'reference_locked' ? 'reference_locked' : 'product_adaptive',
              },
              productImages: normalizeFileArray(source.productImages),
              logoImage: normalizeNullableFile(source.logoImage),
              styleImage: normalizeNullableFile(source.styleImage),
              designReferences: normalizeOneClickReferenceItems(source.designReferences),
              uploadedDesignReferenceUrls: normalizeStringArray(source.uploadedDesignReferenceUrls),
              referenceDimensions: Array.isArray(source.referenceDimensions)
                ? source.referenceDimensions.filter((item: any) => typeof item === 'string')
                : defaultOneClickState.mainImage.referenceDimensions,
              referenceAnalysis: {
                ...defaultOneClickState.mainImage.referenceAnalysis,
                ...(source.referenceAnalysis || {}),
              },
              schemes: Array.isArray(source.schemes) ? source.schemes.map((scheme: any) => ({ ...scheme })) : [],
              uploadedProductUrls: normalizeStringArray(source.uploadedProductUrls),
              uploadedLogoUrl: typeof source.uploadedLogoUrl === 'string' ? source.uploadedLogoUrl : null,
              lastStyleUrl: typeof source.lastStyleUrl === 'string' ? source.lastStyleUrl : null,
              projects,
              activeProjectId: normalizeOneClickActiveProjectId(source.activeProjectId, projects),
            };
          })(),
          detailPage: (() => {
            const source = saved.oneClickMemory.detailPage || defaultOneClickState.detailPage;
            const projects = normalizeOneClickWorkspaceProjects(source.projects, defaultOneClickState.detailPage, '详情');
            return {
              ...source,
              config: normalizeModelField(source.config as any),
              productImages: normalizeFileArray(source.productImages),
              logoImage: normalizeNullableFile(source.logoImage),
              styleImage: normalizeNullableFile(source.styleImage),
              designReferences: normalizeOneClickReferenceItems(source.designReferences),
              uploadedDesignReferenceUrls: normalizeStringArray(source.uploadedDesignReferenceUrls),
              referenceDimensions: Array.isArray(source.referenceDimensions)
                ? source.referenceDimensions.filter((item: any) => typeof item === 'string')
                : defaultOneClickState.detailPage.referenceDimensions,
              referenceAnalysis: {
                ...defaultOneClickState.detailPage.referenceAnalysis,
                ...(source.referenceAnalysis || {}),
              },
              schemes: Array.isArray(source.schemes) ? source.schemes.map((scheme: any) => ({ ...scheme })) : [],
              uploadedProductUrls: normalizeStringArray(source.uploadedProductUrls),
              uploadedLogoUrl: typeof source.uploadedLogoUrl === 'string' ? source.uploadedLogoUrl : null,
              lastStyleUrl: typeof source.lastStyleUrl === 'string' ? source.lastStyleUrl : null,
              projects,
              activeProjectId: normalizeOneClickActiveProjectId(source.activeProjectId, projects),
            };
          })(),
          sku: (() => {
            const source = saved.oneClickMemory.sku || defaultOneClickState.sku;
            const projects = normalizeSkuWorkspaceProjects(source.projects, defaultOneClickState.sku);
            return {
              ...source,
              config: {
                ...defaultOneClickState.sku.config,
                ...normalizeModelField((source.config || defaultOneClickState.sku.config) as any),
                ...(source.config || {}),
                combinations: Array.isArray(source.config?.combinations)
                  ? source.config.combinations.map((item: any) => ({ ...item }))
                  : defaultOneClickState.sku.config.combinations,
              },
              images: Array.isArray(source.images)
                ? source.images.map((img: any) => ({
                    ...img,
                    file: img.file instanceof File ? img.file : null,
                  }))
                : [],
              designReferences: normalizeOneClickReferenceItems(source.designReferences),
              uploadedDesignReferenceUrls: normalizeStringArray(source.uploadedDesignReferenceUrls),
              referenceDimensions: Array.isArray(source.referenceDimensions)
                ? source.referenceDimensions.filter((item: any) => typeof item === 'string')
                : defaultOneClickState.sku.referenceDimensions,
              referenceAnalysis: {
                ...defaultOneClickState.sku.referenceAnalysis,
                ...(source.referenceAnalysis || {}),
              },
              schemes: Array.isArray(source.schemes) ? source.schemes.map((scheme: any) => ({ ...scheme })) : [],
              firstSkuResultUrl: typeof source.firstSkuResultUrl === 'string' ? source.firstSkuResultUrl : null,
              uploadedProductUrls: normalizeStringArray(source.uploadedProductUrls),
              lastStyleUrl: typeof source.lastStyleUrl === 'string' ? source.lastStyleUrl : null,
              projects,
              activeProjectId: normalizeOneClickActiveProjectId(source.activeProjectId, projects),
            };
          })(),
        }
      : undefined,
    retouchMemory: saved.retouchMemory
      ? {
          ...normalizeModelField(saved.retouchMemory as any),
          pendingFiles: normalizeFileArray(saved.retouchMemory.pendingFiles),
          referenceImage: normalizeNullableFile(saved.retouchMemory.referenceImage),
          uploadedReferenceUrl: typeof saved.retouchMemory.uploadedReferenceUrl === 'string'
            ? saved.retouchMemory.uploadedReferenceUrl
            : null,
          tasks: normalizeRetouchTasks(saved.retouchMemory.tasks) as any,
        }
      : undefined,
    buyerShowMemory: saved.buyerShowMemory
      ? {
          ...normalizeModelField(saved.buyerShowMemory as any),
          productImages: normalizeFileArray(saved.buyerShowMemory.productImages),
          referenceImage: normalizeNullableFile(saved.buyerShowMemory.referenceImage),
          uploadedProductUrls: normalizeStringArray(saved.buyerShowMemory.uploadedProductUrls),
          uploadedReferenceUrl: typeof saved.buyerShowMemory.uploadedReferenceUrl === 'string'
            ? saved.buyerShowMemory.uploadedReferenceUrl
            : null,
        }
      : undefined,
    videoMemory: saved.videoMemory
      ? {
          ...saved.videoMemory,
          productImages: normalizeFileArray(saved.videoMemory.productImages),
          uploadedProductUrls: normalizeStringArray(saved.videoMemory.uploadedProductUrls),
          referenceVideoFile: normalizeNullableFile(saved.videoMemory.referenceVideoFile),
          uploadedReferenceVideoUrl: typeof saved.videoMemory.uploadedReferenceVideoUrl === 'string'
            ? saved.videoMemory.uploadedReferenceVideoUrl
            : '',
          veoReferenceImages: normalizeStringArray(saved.videoMemory.veoReferenceImages),
          storyboard: saved.videoMemory.storyboard
            ? {
                ...saved.videoMemory.storyboard,
                config: normalizeVideoStoryboardConfig(saved.videoMemory.storyboard.config, defaultVideoState.storyboard.config),
                projects: Array.isArray(saved.videoMemory.storyboard.projects)
                  ? saved.videoMemory.storyboard.projects.map((project: any) => project
                    ? {
                        ...project,
                        config: project.config
                          ? normalizeVideoStoryboardConfig(project.config, defaultVideoState.storyboard.config)
                          : project.config,
                      }
                    : project)
                  : saved.videoMemory.storyboard.projects,
              }
            : saved.videoMemory.storyboard,
          diagnosis: saved.videoMemory.diagnosis || defaultVideoState.diagnosis,
        }
      : undefined,
    xhsCoverMemory: saved.xhsCoverMemory
      ? (() => {
          const projects = normalizeRestoredXhsCoverProjects(saved.xhsCoverMemory.projects, saved.xhsCoverMemory as any);
          const activeProjectId = typeof saved.xhsCoverMemory.activeProjectId === 'string'
            && projects.some((project) => project.id === saved.xhsCoverMemory.activeProjectId)
            ? saved.xhsCoverMemory.activeProjectId
            : (projects[0]?.id || null);
          const activeProject = projects.find((project) => project.id === activeProjectId) || null;
          return {
            ...normalizeModelField(saved.xhsCoverMemory as any),
            productImages: normalizeFileArray(saved.xhsCoverMemory.productImages),
            uploadedProductUrls: normalizeStringArray(saved.xhsCoverMemory.uploadedProductUrls),
            styleReferenceImage: normalizeNullableFile(saved.xhsCoverMemory.styleReferenceImage),
            uploadedStyleReferenceUrl: typeof saved.xhsCoverMemory.uploadedStyleReferenceUrl === 'string'
              ? saved.xhsCoverMemory.uploadedStyleReferenceUrl
              : null,
            projects,
            activeProjectId,
            tasks: activeProject?.tasks || normalizeRestoredXhsCoverTasks(saved.xhsCoverMemory.tasks),
            isGenerating: false,
          };
        })()
      : undefined,
  };
};

const resetRuntimeFlags = (saved: Partial<PersistedAppState>): Partial<PersistedAppState> => ({
  ...saved,
  translationMemory: saved.translationMemory
    ? {
        main: { ...saved.translationMemory.main, isProcessing: false },
        detail: { ...saved.translationMemory.detail, isProcessing: false },
        removeText: { ...saved.translationMemory.removeText, isProcessing: false },
      }
    : undefined,
  buyerShowMemory: saved.buyerShowMemory
    ? { ...saved.buyerShowMemory, isAnalyzing: false, isGenerating: false }
    : undefined,
  videoMemory: saved.videoMemory
    ? { ...saved.videoMemory, isAnalyzing: false, isGenerating: false }
    : undefined,
});

export const loadPersistedAppState = (userId?: string | null): Partial<PersistedAppState> => {
  try {
    const saved = readBoundedPersistedStateStorage(getPersistedAppStateKey(userId));
    if (!saved) return {};
    if (persistedStateCache?.raw === saved) return persistedStateCache.state;

    const normalized = resetRuntimeFlags(normalizeLoadedPersistedAppState(JSON.parse(saved)));
    persistedStateCache = { raw: saved, state: normalized };
    return normalized;
  } catch (error) {
    persistedStateCache = null;
    console.error('Failed to load state from localStorage', error);
    return {};
  }
};

export const savePersistedAppState = (state: PersistedAppState, userId?: string | null) => {
  try {
    const cleaned = cleanState(state);
    const serialized = JSON.stringify(cleaned);
    localStorage.setItem(getPersistedAppStateKey(userId), serialized);
    persistedStateCache = {
      raw: serialized,
      state: resetRuntimeFlags(normalizeLoadedPersistedAppState(cleaned)),
    };
  } catch (error) {
    console.error('Failed to save state to localStorage', error);
  }
};

export const sanitizePersistedAppState = (state: PersistedAppState): PersistedAppState => {
  return {
    ...(cleanState(state) as PersistedAppState),
    apiConfig: sanitizeApiConfig(state.apiConfig),
  };
};

export const buildPersistedAppState = (saved?: Partial<PersistedAppState>): PersistedAppState => {
  const translationConfigs = migrateLegacyTranslationConfigs(saved?.moduleConfig, saved?.translationConfigs) || createDefaultTranslationConfigState();

  return {
    activeModule: saved?.activeModule || DEFAULT_ACTIVE_MODULE,
    apiConfig: sanitizeApiConfig(saved?.apiConfig),
    moduleConfig: getLegacyTranslationModuleConfig(translationConfigs) || createDefaultModuleConfig(),
    translationConfigs,
    translationMemory: saved?.translationMemory || createDefaultTranslationState(),
    oneClickMemory: saved?.oneClickMemory || createDefaultOneClickState(),
    retouchMemory: saved?.retouchMemory || createDefaultRetouchState(),
    buyerShowMemory: saved?.buyerShowMemory || createDefaultBuyerShowState(),
    videoMemory: saved?.videoMemory || createDefaultVideoState(),
    xhsCoverMemory: saved?.xhsCoverMemory || createDefaultXhsCoverState(),
    shellDraft: normalizeShellDraftState(saved?.shellDraft),
    shellProjects: Array.isArray(saved?.shellProjects) ? saved.shellProjects : [],
  };
};
