import {
  AppModule,
  AspectRatio,
  BuyerShowPersistentState,
  BuyerShowSubMode,
  GlobalApiConfig,
  ModuleConfig,
  OneClickPersistentState,
  RetouchPersistentState,
  TranslationModuleConfigs,
  TranslationPersistentState,
  VideoPersistentState,
  VideoSubMode,
} from '../types';
import {
  createDefaultTranslationConfigs,
  getLegacyTranslationModuleConfig,
  migrateLegacyTranslationConfigs,
} from '../modules/Translation/translationConfigUtils.mjs';
import { hasReusableTaskAsset } from './cloudAssetState.mjs';

export const PERSISTENCE_KEY = 'AIGC_APP_STATE_V1';

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
}

export const createDefaultApiConfig = (): GlobalApiConfig => ({
  kieApiKey: '',
  concurrency: 5,
  arkApiKey: '',
});

const sanitizeApiConfig = (config?: Partial<GlobalApiConfig>): GlobalApiConfig => ({
  kieApiKey: '',
  concurrency: typeof config?.concurrency === 'number' && config.concurrency > 0 ? config.concurrency : 5,
  arkApiKey: '',
});

export const createDefaultModuleConfig = (): ModuleConfig => ({
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: AspectRatio.AUTO,
  quality: '1k',
  model: 'nano-banana-2',
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
  mainImage: {
    productImages: [],
    styleImage: null,
    schemes: [],
    config: {
      description: '',
      platformType: 'domestic',
      platform: '淘宝',
      language: '中文',
      count: 3,
      aspectRatio: AspectRatio.SQUARE,
      quality: '1k',
      model: 'nano-banana-2',
      styleStrength: 'medium',
      resolutionMode: 'custom',
      targetWidth: 800,
      targetHeight: 800,
      maxFileSize: 2.0,
    },
    lastStyleUrl: null,
    uploadedProductUrls: [],
    directions: [],
  },
  detailPage: {
    productImages: [],
    styleImage: null,
    schemes: [],
    config: {
      description: '',
      platformType: 'domestic',
      platform: '淘宝',
      language: '中文',
      count: 7,
      aspectRatio: AspectRatio.AUTO,
      quality: '1k',
      model: 'nano-banana-2',
      styleStrength: 'medium',
      resolutionMode: 'custom',
      targetWidth: 750,
      targetHeight: 0,
      maxFileSize: 2.0,
    },
    lastStyleUrl: null,
    uploadedProductUrls: [],
    directions: [],
  },
});

export const createDefaultRetouchState = (): RetouchPersistentState => ({
  tasks: [],
  pendingFiles: [],
  referenceImage: null,
  uploadedReferenceUrl: null,
  mode: 'white_bg',
  aspectRatio: AspectRatio.AUTO,
  quality: '1k',
  model: 'nano-banana-2',
  resolutionMode: 'original',
  targetWidth: 0,
  targetHeight: 0,
});

export const createDefaultBuyerShowState = (): BuyerShowPersistentState => ({
  subMode: BuyerShowSubMode.INTEGRATED,
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
  aspectRatio: AspectRatio.P_3_4,
  quality: '1k',
  model: 'nano-banana-2',
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
  subMode: VideoSubMode.LONG_VIDEO,
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
  veoProjects: [],
  veoReferenceImages: [],
  isAnalyzing: false,
  isGenerating: false,
  storyboard: {
    config: {
      productImages: [],
      uploadedProductUrls: [],
      productInfo: '',
      scriptLogic: '',
      scriptPreset: 'custom',
      aspectRatio: AspectRatio.P_9_16,
      duration: '15s',
      shotCount: 9,
      actorType: 'no_real_face',
      projectCount: 1,
      scenes: [''],
      countryLanguage: '中国/中文',
      generateWhiteBg: false,
      model: 'nano-banana-pro',
      quality: '2k',
    },
    projects: [],
    downloadingProjectId: null,
  },
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

  return {
    ...saved,
    translationConfigs,
    moduleConfig: getLegacyTranslationModuleConfig(translationConfigs),
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
          mainImage: {
            ...saved.oneClickMemory.mainImage,
            productImages: normalizeFileArray(saved.oneClickMemory.mainImage?.productImages),
            styleImage: normalizeNullableFile(saved.oneClickMemory.mainImage?.styleImage),
          },
          detailPage: {
            ...saved.oneClickMemory.detailPage,
            productImages: normalizeFileArray(saved.oneClickMemory.detailPage?.productImages),
            styleImage: normalizeNullableFile(saved.oneClickMemory.detailPage?.styleImage),
          },
        }
      : undefined,
    retouchMemory: saved.retouchMemory
      ? {
          ...saved.retouchMemory,
          pendingFiles: normalizeFileArray(saved.retouchMemory.pendingFiles),
          referenceImage: normalizeNullableFile(saved.retouchMemory.referenceImage),
          tasks: normalizeRetouchTasks(saved.retouchMemory.tasks) as any,
        }
      : undefined,
    buyerShowMemory: saved.buyerShowMemory
      ? {
          ...saved.buyerShowMemory,
          productImages: normalizeFileArray(saved.buyerShowMemory.productImages),
          referenceImage: normalizeNullableFile(saved.buyerShowMemory.referenceImage),
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
                config: {
                  ...saved.videoMemory.storyboard.config,
                  productImages: normalizeFileArray(saved.videoMemory.storyboard.config?.productImages),
                },
              }
            : saved.videoMemory.storyboard,
        }
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

export const loadPersistedAppState = (): Partial<PersistedAppState> => {
  try {
    const saved = localStorage.getItem(PERSISTENCE_KEY);
    if (!saved) return {};

    return resetRuntimeFlags(normalizeLoadedPersistedAppState(JSON.parse(saved)));
  } catch (error) {
    console.error('Failed to load state from localStorage', error);
    return {};
  }
};

export const savePersistedAppState = (state: PersistedAppState) => {
  try {
    localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(cleanState(state)));
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
    activeModule: saved?.activeModule || AppModule.ONE_CLICK,
    apiConfig: sanitizeApiConfig(saved?.apiConfig),
    moduleConfig: getLegacyTranslationModuleConfig(translationConfigs) || createDefaultModuleConfig(),
    translationConfigs,
    translationMemory: saved?.translationMemory || createDefaultTranslationState(),
    oneClickMemory: saved?.oneClickMemory || createDefaultOneClickState(),
    retouchMemory: saved?.retouchMemory || createDefaultRetouchState(),
    buyerShowMemory: saved?.buyerShowMemory || createDefaultBuyerShowState(),
    videoMemory: saved?.videoMemory || createDefaultVideoState(),
  };
};
