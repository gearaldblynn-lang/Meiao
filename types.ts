
export enum AppModule {
  ONE_CLICK = 'one_click',
  TRANSLATION = 'translation',
  BUYER_SHOW = 'buyer_show',
  RETOUCH = 'retouch',
  PHOTOGRAPHY = 'photography',
  VIDEO = 'video',
  SETTINGS = 'settings',
  ACCOUNT = 'account'
}

export enum TranslationSubMode {
  MAIN = 'main',
  DETAIL = 'detail',
  REMOVE_TEXT = 'remove_text'
}

export enum OneClickSubMode {
  MAIN_IMAGE = 'main_image',
  DETAIL_PAGE = 'detail_page',
  SKU = 'sku',
}

export enum BuyerShowSubMode {
  INTEGRATED = 'integrated',
  PURE_TEXT = 'pure_text'
}

export enum VideoSubMode {
  LONG_VIDEO = 'long_video',
  VEO = 'veo',
  STORYBOARD = 'storyboard'
}

export enum AspectRatio {
  AUTO = 'auto',
  SQUARE = '1:1',
  P_1_4 = '1:4',
  P_1_8 = '1:8',
  P_2_3 = '2:3',
  L_3_2 = '3:2',
  P_3_4 = '3:4',
  L_4_1 = '4:1',
  L_4_3 = '4:3',
  P_4_5 = '4:5',
  L_5_4 = '5:4',
  L_8_1 = '8:1',
  P_9_16 = '9:16',
  L_16_9 = '16:9',
  L_21_9 = '21:9',
}

export type GenerationQuality = '1k' | '2k' | '4k';
export type StyleStrength = 'low' | 'medium' | 'high';
export type KieAiModel = 'nano-banana-2' | 'nano-banana-pro';

export interface GlobalApiConfig {
  kieApiKey: string;
  concurrency: number;
  arkApiKey: string;
}

export interface InternalJob {
  id: string;
  userId: string;
  module: string;
  taskType: string;
  provider: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retry_waiting';
  priority: number;
  payload: Record<string, unknown>;
  providerTaskId: string;
  result: Record<string, unknown> | null;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  cancelRequestedAt: number | null;
}

export interface SystemPublicConfig {
  queue: {
    maxConcurrency: number;
    queuedCount: number;
    runningCount: number;
  };
  cors: {
    allowedOrigins: string[];
  };
  providers: {
    ark: { configured: boolean };
    kie: { configured: boolean };
  };
}

export type UserRole = 'admin' | 'staff';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
  jobConcurrency: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface InternalLogEntry {
  id: string;
  createdAt: number;
  level: 'info' | 'error';
  module: string;
  action: string;
  message: string;
  detail?: string;
  status: 'success' | 'failed' | 'started' | 'interrupted';
  userId: string;
  username: string;
  displayName: string;
  meta?: Record<string, unknown>;
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

export interface SourceImageContext {
  width: number;
  height: number;
  ratioLabel: string;
}

export interface TranslationPersistentState {
  main: {
    files: FileItem[];
    isProcessing: boolean;
  };
  detail: {
    files: FileItem[];
    isProcessing: boolean;
  };
  removeText: {
    files: FileItem[];
    isProcessing: boolean;
  };
}

export interface SceneItem {
  Scene: string;
  duration: number;
}

export interface VideoConfig {
  // Update: Added 40, 48, 56, 60 for extended Veo duration
  duration: '8' | '10' | '15' | '16' | '24' | '25' | '32' | '40' | '48' | '56' | '60';
  aspectRatio: 'portrait' | 'landscape';
  promptMode: 'ai' | 'manual';
  script: string;
  scenes: SceneItem[];
  productInfo: string;
  requirements: string;
  referenceVideoUrl?: string;
  targetCountry: string;
  customCountry?: string;
  
  // Veo Specific
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

// === Veo AI Workflow Types ===
export interface VeoScriptSegment {
  id: string;
  type: 'INITIAL' | 'EXTENSION';
  title: string;
  style: string;
  description: string;
  spokenContent: string;
  bgm: string;
  duration: number;
}

export interface VeoVariant {
  id: string;
  taskId: string; 
  uri: string;
  blobUrl: string;
  createdAt: number;
  schemeName: string;
}

export interface VeoSegmentState {
  segmentId: string;
  script: VeoScriptSegment;
  variants: VeoVariant[];
  selectedVariantId: string | null;
  status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  lastTaskId?: string;
  errorMsg?: string;
}

export interface VeoProjectState {
  id: string;
  name: string;
  states: VeoSegmentState[];
  isExpanded: boolean;
}
// ==============================

export interface VideoPersistentState {
  subMode: VideoSubMode;
  config: VideoConfig;
  productImages: File[];
  uploadedProductUrls?: string[];
  referenceVideoFile: File | null;
  uploadedReferenceVideoUrl?: string | null;
  tasks: VideoTask[]; // Legacy / Sora tasks
  
  // Veo Specific Storage
  veoProjects: VeoProjectState[];
  veoReferenceImages: string[];
  
  isAnalyzing: boolean;
  isGenerating: boolean;
  storyboard: VideoStoryboardState;
}

export interface VideoStoryboardConfig {
  productImages: File[];
  uploadedProductUrls: string[];
  productInfo: string;
  scriptLogic: string;
  scriptPreset: 'custom' | 'ecommerce' | 'viral';
  aspectRatio: AspectRatio.SQUARE | AspectRatio.P_3_4 | AspectRatio.L_4_3 | AspectRatio.P_4_5 | AspectRatio.P_9_16 | AspectRatio.L_16_9;
  duration: '5s' | '10s' | '15s' | '30s';
  shotCount: 1 | 3 | 4 | 6 | 8 | 9 | 12;
  actorType: 'no_real_face' | 'real_person' | '3d_digital_human' | 'cartoon_character';
  projectCount: number;
  scenes: string[];
  countryLanguage: string;
  generateWhiteBg: boolean;
  model: KieAiModel;
  quality: GenerationQuality;
  generationMode: 'single_image' | 'multi_image';
}

export interface VideoStoryboardShot {
  id: string;
  description: string;
  scriptContent: string;
  prompt: string;
  imageUrl?: string;
  taskId?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
}

export interface VideoStoryboardProject {
  id: string;
  name: string;
  config: VideoStoryboardConfig;
  status: 'pending' | 'scripting' | 'imaging' | 'completed' | 'failed';
  script: string;
  shots: VideoStoryboardShot[];
  boards: VideoStoryboardBoard[];
  whiteBgImageUrl?: string;
  whiteBgTaskId?: string;
  whiteBgStatus?: 'pending' | 'generating' | 'completed' | 'failed';
  createdAt: number;
  sceneDescription?: string;
  error?: string;
}

export interface VideoStoryboardBoard {
  id: string;
  title: string;
  shotIds: string[];
  scriptText: string;
  prompt: string;
  imageUrl?: string;
  taskId?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
  previousBoardImageUrl?: string;
}

export interface VideoStoryboardState {
  config: VideoStoryboardConfig;
  projects: VideoStoryboardProject[];
  downloadingProjectId: string | null;
}

export interface OneClickConfig {
  description: string;
  planningLogic?: string; 
  platformType: 'domestic' | 'crossborder';
  platform: string;
  language: string;
  count: number;
  aspectRatio?: AspectRatio;
  quality: GenerationQuality;
  model: KieAiModel;
  styleStrength: StyleStrength;
  resolutionMode: 'original' | 'custom';
  targetWidth?: number;
  targetHeight?: number;
  maxFileSize: number;
}

export interface MainImageScheme {
  id: string;
  taskId?: string; 
  uiTitle?: string; 
  originalContent: string;
  editedContent: string;
  status: 'pending' | 'generating' | 'completed' | 'error' | 'interrupted';
  selected: boolean; 
  resultUrl?: string;
  error?: string;
  extractedRatio?: string; 
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

export interface BuyerShowSet {
  id: string;
  index: number;
  tasks: BuyerShowTask[];
  evaluationText: string;
  status: 'pending' | 'analyzing' | 'generating' | 'completed';
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
  
  // 多套方案支持
  setCount: number;
  sets: BuyerShowSet[];

  // 兼容旧字段（UI主要读取 sets，这两个字段作为当前选中或Legacy展示）
  tasks: BuyerShowTask[];
  evaluationText: string;
  
  pureEvaluations: string[];
  firstImageConfirmed: boolean;
  isAnalyzing: boolean;
  isGenerating: boolean;
}

export interface FileItem {
  id: string;
  file: File | null;
  fileName?: string;
  relativePath: string;
  originalWidth?: number;
  originalHeight?: number;
  sourceUrl?: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'interrupted';
  progress: number;
  resultBlob?: Blob;
  resultUrl?: string;
  sourcePreviewUrl?: string;
  matchedAspectRatio?: string;
  error?: string;
  taskId?: string;
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

export interface OneClickPersistentState {
  mainImage: {
    productImages: File[];
    styleImage: File | null;
    schemes: MainImageScheme[];
    config: OneClickConfig;
    lastStyleUrl: string | null;
    uploadedProductUrls: string[];
    directions: string[];
  };
  detailPage: {
    productImages: File[];
    styleImage: File | null;
    schemes: MainImageScheme[];
    config: OneClickConfig;
    lastStyleUrl: string | null;
    uploadedProductUrls: string[];
    directions: string[];
  };
  sku: SkuPersistentSubState;
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

export interface KieAiResult {
  imageUrl: string;
  videoUrl?: string;
  taskId?: string; 
  status: 'success' | 'error' | 'interrupted' | 'task_not_found';
  message?: string;
}

export interface ArkAnalysisResult {
  description: string;
  status: 'success' | 'error';
  message?: string;
}

export interface ArkBuyerShowResult {
  tasks: { prompt: string; style: string; hasFace: boolean }[];
  evaluation: string;
  status: 'success' | 'error';
  message?: string;
}

export interface ArkPureEvaluationResult {
  evaluations: string[];
  status: 'success' | 'error';
  message?: string;
}

export interface ArkSchemeResult {
  schemes: string[];
  status: 'success' | 'error';
  message?: string;
}

export interface VisualDirectionResult {
  directions: string[];
  status: 'success' | 'error';
  message?: string;
}

// ── SKU 相关类型 ──

export type SkuImageRole = 'product' | 'gift' | 'style_ref';

export interface SkuImageItem {
  id: string;
  file: File | null;
  role: SkuImageRole;
  giftIndex?: number;
  uploadedUrl: string | null;
}

export interface SkuCombinationRule {
  id: string;
  sceneDescription: string;
  skuCopyText: string;
}

export interface SkuConfig {
  productInfo: string;
  language: string;
  count: number;
  combinations: SkuCombinationRule[];
  aspectRatio?: AspectRatio;
  quality: GenerationQuality;
  model: KieAiModel;
  styleStrength: StyleStrength;
  resolutionMode: 'original' | 'custom';
  targetWidth?: number;
  targetHeight?: number;
  maxFileSize: number;
}

export interface SkuScheme {
  id: string;
  taskId?: string;
  combinationId: string;
  uiTitle: string;
  originalContent: string;
  editedContent: string;
  extractedRatio: string;
  selected: boolean;
  status: 'pending' | 'generating' | 'completed' | 'error' | 'interrupted';
  resultUrl?: string;
  error?: string;
}

export interface SkuPersistentSubState {
  images: SkuImageItem[];
  schemes: SkuScheme[];
  config: SkuConfig;
  firstSkuResultUrl: string | null;
  uploadedProductUrls: string[];
  lastStyleUrl: string | null;
}
