// Core types extracted from original types.ts
// In production, this should be the complete types.ts from the original project

export type AppModule =
  | 'agent_center'
  | 'one_click'
  | 'translation'
  | 'buyer_show'
  | 'retouch'
  | 'photography'
  | 'video'
  | 'xhs_cover'
  | 'settings'
  | 'account';

export const AppModuleObj = {
  AGENT_CENTER: 'agent_center' as AppModule,
  ONE_CLICK: 'one_click' as AppModule,
  TRANSLATION: 'translation' as AppModule,
  BUYER_SHOW: 'buyer_show' as AppModule,
  RETOUCH: 'retouch' as AppModule,
  PHOTOGRAPHY: 'photography' as AppModule,
  VIDEO: 'video' as AppModule,
  XHS_COVER: 'xhs_cover' as AppModule,
  SETTINGS: 'settings' as AppModule,
  ACCOUNT: 'account' as AppModule,
};

export type TranslationSubMode = 'main' | 'detail' | 'remove_text';

export const TranslationSubModeObj = {
  MAIN: 'main' as TranslationSubMode,
  DETAIL: 'detail' as TranslationSubMode,
  REMOVE_TEXT: 'remove_text' as TranslationSubMode,
};

export type OneClickSubMode = 'first_image' | 'main_image' | 'detail_page' | 'sku';

export type BuyerShowSubMode = 'integrated' | 'pure_text';

export type VideoSubMode = 'long_video' | 'veo' | 'storyboard' | 'diagnosis';

export type AspectRatio =
  | 'auto'
  | '1:1'
  | '1:4'
  | '1:8'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:1'
  | '4:3'
  | '4:5'
  | '5:4'
  | '8:1'
  | '9:16'
  | '16:9'
  | '21:9';

export type GenerationQuality = '1k' | '2k' | '4k';
export type StyleStrength = 'low' | 'medium' | 'high';
export type KieAiModel = 'nano-banana-2' | 'gpt-image-2' | 'gpt-image-2-secondary';

export interface GlobalApiConfig {
  kieApiKey: string;
  concurrency: number;
}

export type UserRole = 'admin' | 'staff';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  isSuperAdmin?: boolean;
  status: 'active' | 'disabled';
  jobConcurrency: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface ModuleConfig {
  targetLanguage: string;
  customLanguage: string;
  removeWatermark: boolean;
  aspectRatio: AspectRatio;
  quality: GenerationQuality;
  model: KieAiModel;
  resolutionMode: 'original' | 'custom';
  targetWidth: number;
  targetHeight: number;
  maxFileSize: number;
}

export interface TranslationModuleConfigs {
  main: ModuleConfig;
  detail: ModuleConfig;
  removeText: ModuleConfig;
}

export interface FileItem {
  id: string;
  file: File | null;
  fileName?: string;
  relativePath: string;
  originalWidth?: number;
  originalHeight?: number;
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'interrupted';
  progress: number;
  resultBlob?: Blob;
  resultUrl?: string;
  matchedAspectRatio?: string;
  error?: string;
  taskId?: string;
}

export interface TranslationPersistentState {
  main: { files: FileItem[]; isProcessing: boolean };
  detail: { files: FileItem[]; isProcessing: boolean };
  removeText: { files: FileItem[]; isProcessing: boolean };
}

export interface RetouchTask {
  id: string;
  taskId?: string;
  file: File | null;
  fileName?: string;
  relativePath: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'interrupted';
  progress: number;
  resultBlob?: Blob;
  error?: string;
  sourceUrl?: string;
  aiDescription?: string;
  mode: 'original' | 'white_bg';
  retouchPrompt?: string;
  resultUrl?: string;
}

export interface RetouchPersistentState {
  tasks: RetouchTask[];
  pendingFiles: File[];
  referenceImage: File | null;
  uploadedReferenceUrl?: string | null;
  mode: 'original' | 'white_bg';
  aspectRatio: AspectRatio;
  quality: GenerationQuality;
  model: KieAiModel;
  resolutionMode: 'original' | 'custom';
  targetWidth: number;
  targetHeight: number;
}

export interface BuyerShowTask {
  id: string;
  taskId?: string;
  prompt: string;
  styleDescription: string;
  hasFace: boolean;
  status: 'pending' | 'generating' | 'completed' | 'error' | 'interrupted';
  resultUrl?: string;
  error?: string;
  fileName?: string;
}

export interface BuyerShowPersistentState {
  subMode: BuyerShowSubMode;
  productImages: File[];
  uploadedProductUrls?: string[];
  referenceImage: File | null;
  uploadedReferenceUrl?: string | null;
  referenceStrength: StyleStrength;
  productName: string;
  productFeatures: string;
  userRequirement: string;
  targetCountry: string;
  customCountry?: string;
  includeModel: boolean;
  aspectRatio: AspectRatio;
  quality: GenerationQuality;
  model: KieAiModel;
  imageCount: number;
  setCount: number;
  sets: any[];
  tasks: BuyerShowTask[];
  evaluationText: string;
  pureEvaluations: string[];
  firstImageConfirmed: boolean;
  isAnalyzing: boolean;
  isGenerating: boolean;
}

export type VideoDiagnosisPlatform = 'tiktok' | 'douyin' | 'xhs';
export type VideoDiagnosisAccessMode = 'spider_api' | 'web_session';

export interface VideoConfig {
  duration: '8' | '10' | '15' | '16' | '24' | '25' | '32' | '40' | '48' | '56' | '60';
  aspectRatio: 'portrait' | 'landscape';
  promptMode: 'ai' | 'manual';
  script: string;
  scenes: any[];
  productInfo: string;
  requirements: string;
  referenceVideoUrl?: string;
  targetCountry: string;
  customCountry?: string;
  videoCount: number;
  targetLanguage: string;
  sellingPoints: string;
  logicInfo: string;
}

export interface VideoTask {
  id: string;
  taskId?: string;
  status: 'pending' | 'generating' | 'completed' | 'error' | 'interrupted';
  resultUrl?: string;
  error?: string;
  createTime: number;
}

export interface VideoPersistentState {
  subMode: VideoSubMode;
  config: VideoConfig;
  productImages: File[];
  uploadedProductUrls?: string[];
  referenceVideoFile: File | null;
  uploadedReferenceVideoUrl?: string | null;
  tasks: VideoTask[];
  diagnosis: any;
  veoProjects: any[];
  veoReferenceImages: string[];
  isAnalyzing: boolean;
  isGenerating: boolean;
  storyboard: any;
}

export interface XhsCoverPersistentState {
  productImages: File[];
  uploadedProductUrls?: string[];
  title: string;
  subtitle: string;
  selectedStyleIds: string[];
  fontStyle: any;
  aspectRatio: any;
  quality: GenerationQuality;
  model: KieAiModel;
  decoration: string;
  extraRequirement: string;
  projects: any[];
  activeProjectId: string | null;
  tasks: any[];
  isGenerating: boolean;
}

export interface OneClickConfig {
  description: string;
  planningLogic?: string;
  platformType: 'domestic' | 'crossborder';
  platform: string;
  language: string;
  count: number;
  aspectRatio?: AspectRatio;
  firstImageColorMode?: 'product_adaptive' | 'reference_locked';
  quality: GenerationQuality;
  model: KieAiModel;
  styleStrength: StyleStrength;
  resolutionMode: 'original' | 'custom';
  targetWidth?: number;
  targetHeight?: number;
  maxFileSize: number;
}

export interface OneClickPersistentState {
  referencePresets: any;
  firstImage: any;
  mainImage: any;
  detailPage: any;
  sku: any;
}

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
}

export type ModuleInterfaceId = 'one_click_main';

export interface SystemPublicConfig {
  queue: {
    maxConcurrency: number;
    queuedCount: number;
    runningCount: number;
  };
  cors: { allowedOrigins: string[] };
  providers: { kie: { configured: boolean }; apiports?: { configured: boolean } };
  systemSettings: {
    analysisModel: string;
    effectiveAnalysisModel: string;
    videoAnalysisModel: string;
    effectiveVideoAnalysisModel: string;
    videoAnalysisReasoningLevel: string;
  };
  publicBaseUrl: string;
  agentModels: {
    chat: Array<any>;
    image: Array<any>;
  };
}

// Kie AI
export interface KieAiResult {
  imageUrl: string;
  videoUrl?: string;
  taskId?: string;
  status: 'success' | 'error' | 'interrupted' | 'task_not_found';
  message?: string;
  errorCode?: string;
  creditsConsumed?: number;
}
