import {
  AppModule,
  AspectRatio,
  BuyerShowPersistentState,
  BuyerShowSubMode,
  GlobalApiConfig,
  ModuleConfig,
  OneClickPersistentState,
  RetouchPersistentState,
  TranslationPersistentState,
  VideoPersistentState,
  VideoSubMode,
} from '../types';

export const PERSISTENCE_KEY = 'AIGC_APP_STATE_V1';

export interface PersistedAppState {
  activeModule: AppModule;
  apiConfig: GlobalApiConfig;
  moduleConfig: ModuleConfig;
  translationMemory: TranslationPersistentState;
  oneClickMemory: OneClickPersistentState;
  retouchMemory: RetouchPersistentState;
  buyerShowMemory: BuyerShowPersistentState;
  videoMemory: VideoPersistentState;
}

export const createDefaultApiConfig = (): GlobalApiConfig => ({
  kieApiKey: '265262466b15cd45e574dc0dd846a8fc',
  concurrency: 5,
  arkApiKey: 'ad4fa376-91ef-4ba4-b8f4-84a9fa272439',
  rhWebappId: '',
  rhApiKey: '',
  rhQuickCreateCode: '',
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
  referenceVideoFile: null,
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

    return resetRuntimeFlags(JSON.parse(saved));
  } catch (error) {
    console.error('Failed to load state from localStorage', error);
    return {};
  }
};

export const savePersistedAppState = (state: PersistedAppState) => {
  localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(cleanState(state)));
};
