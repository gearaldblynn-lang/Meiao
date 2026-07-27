import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir as mkdirAsync, mkdtemp, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentPromptMessages,
  buildConversationSummary,
  chunkKnowledgeText,
  createDefaultVersionName,
  estimateCostByTokens,
  estimateTokenCount,
  normalizeKnowledgeChunkStrategy,
  normalizeAgentConfig,
  parseAgentToolCalls,
  searchKnowledgeChunks,
  stripAgentToolCalls,
  MODULE_INTERFACES,
} from '../src/modules/AgentCenter/agentCenterUtils.mjs';
import { buildLogFilterOptions, normalizeLogPagination } from '../src/modules/Account/logQueryUtils.mjs';
import { isMaxForAiImageModel } from '../src/utils/maxforaiImageModels.mjs';
import { loadServerEnvFile } from './envLoader.mjs';
import { configureServerNetworkRuntime } from './networkRuntime.mjs';
import { handleChatwootAiWebhook } from './chatwootAiResponder.mjs';
import {
  assignChatwootConversation,
  createChatwootCannedResponse,
  createChatwootCampaign,
  createChatwootContactNote,
  createChatwootInternalNote,
  createChatwootMacro,
  createChatwootWebhook,
  deleteChatwootConversationMessage,
  executeChatwootMacro,
  listChatwootAssignableAgents,
  listChatwootAutomationRules,
  listChatwootCannedResponses,
  listChatwootCampaigns,
  listChatwootContacts,
  listChatwootContactConversations,
  listChatwootContactNotes,
  listChatwootConversationMessages,
  listChatwootConversations,
  listChatwootInboxes,
  listChatwootLabels,
  listChatwootMacros,
  listChatwootReportsSummary,
  listChatwootTeams,
  listChatwootWebhooks,
  retryChatwootConversationMessage,
  sendChatwootConversationAttachment,
  sendChatwootConversationMessage,
  testChatwootConnection,
  translateChatwootConversationMessage,
  updateChatwootContact,
  updateChatwootConversationLabels,
  updateChatwootConversationStatus,
  updateChatwootInbox,
  updateChatwootWebhook,
} from './chatwootClient.mjs';
import {
  filterVisibleChatSessions,
  isStudioTestChatSession,
  resolveSessionReasoningLevel,
} from './chatSessionRules.mjs';
import { resolveContextLimits } from './contextPlan.mjs';
import { formatChatSseEvent, startChatSseHeartbeat } from './chatStreaming.mjs';
import { embedTexts } from './embeddingProvider.mjs';
import { searchKnowledgeChunksByVector } from './ragRetrieval.mjs';
import { runAgentConversationV2 } from './agentToolConversation.mjs';
import { shouldUseToolCallingConversation } from './agentConversationRouting.mjs';
import { ensureJobsSchema, createJobRecord, createSerializedJobSubmission, createSerializedJobSubmissionOnConnection, deleteJobById, findJobByProviderTaskIdForUser, findReusableJobRecord, getJobById, getJobByIdForUpdate, getSubtitleRemovalSubmissionGuardState, listJobsByIdsForUser, listJobsForUser, getJobQueueStats, reconcileRestartedProviderlessRunningJobs, reconcileRestartedRunningJobs, reconcileStaleCancelledRunningJobs, reconcileStaleProviderlessRunningJobs, reconcileStaleSubmittedRunningJobs, requestCancelJob, requestRetryJob, requestTombstonedJobRecovery, resolveJobDeletionAction, resolveSubmissionUnknownJob, updateJobFields, createJobWorker, withMysqlSubmissionLock, withMysqlTransaction } from './jobManager.mjs';
import { assertSubtitleRemovalBatchSubmissionAllowed, assertSubtitleRemovalRetryAllowed, assertSubmissionKnownBeforeRetry, buildSubtitleRemovalUserGuardSubmission } from './subtitleRemovalBatchGuard.mjs';
import {
  CREDIT_LIMIT_MODES,
  attachCreditReservationToJobPayload,
  estimateCreditReservation,
  getCreditAvailable,
  getCreditReservationFromJob,
  getJobCreditRetryReservationAction,
  getLocalCreditReservationState,
  normalizeCreditAccount,
  releaseLocalAccountCredits,
  reserveLocalAccountCredits,
  settleLocalAccountCredits,
  shouldReleaseJobCreditReservation,
  stripCreditReservationFromPayload,
} from './accountCredits.mjs';
import { buildSubmissionResolutionCapability, ensureTaskPlatformSchema, getTaskPlatformHealth, getTaskPlatformTimeline, listTaskPlatformJobs, normalizeTaskEngineMode, recordJobEvent } from './taskPlatform.mjs';
import {
  attachLocalJobWorkflowExecution,
  createLocalJobRecord,
  createLocalJobWorker,
  deleteLocalJobRecord,
  findLocalJobByProviderTaskIdForUser,
  findReusableLocalJobRecord,
  getLocalJobById,
  getLocalJobQueueStats,
  listLocalJobsForUser,
  markLocalJobCompleted,
  updateLocalJobResult,
  markLocalJobFailed,
  normalizeLocalJobs,
  reconcileRestartedLocalJobs,
  requestLocalCancelJob,
  requestLocalRetryJob,
  resolveLocalSubmissionUnknownJob,
} from './localJobStore.mjs';
import {
  assertDeployRequestAllowed,
  beginDeployRequestTracking,
  getDeployRequestSnapshot,
} from './deployDrain.mjs';
import {
  createGracefulShutdown,
  getProcessReleaseIdentity,
  listenAndNotifyReady,
  registerProcessShutdown,
  resolveServerListenConfig,
} from './processLifecycle.mjs';
import { createAuthorizedProviderRecovery } from './jobRecoveryService.mjs';
import { prepareKieTtsOutputForPersistence, persistManagedRemoteJobOutput } from './jobOutputAssetPersistence.mjs';
import { executeProviderJob, uploadAssetViaKieStream } from './providerGateway.mjs';
import { resolveProviderChatMediaUrl as resolveProviderChatMediaUrlForModel } from './providerAssetTransfer.mjs';
import { resolveProviderGenerationMediaUrl } from './providerAssetTransfer.mjs';
import {
  filterAvailableAgentImageUrls,
  normalizeAgentImageUrl,
  resolveAgentImagePlanInputUrlDetails,
  shouldRequireAgentImageInput,
} from './agentImagePlan.mjs';
import { compactAppStateForStorage, mergeAppStateForStorage, trimAppStateForStorage, writeMergedAppStateUnderUserLock } from './appStateMerge.mjs';
import { buildJobRuntimeLogMeta, buildPublicSystemConfig, buildVoiceoverHealthSnapshot, dispatchApplicationJob, getWorkerConcurrencyLimit, isTransientMysqlConnectionError, normalizeAllowedOrigins, runWithTransientRetry, getReconcileBackoffMs, shouldSettleProviderCompletedRejectedJob } from './jobRuntime.mjs';
import { GPT_IMAGE_2_DEFAULT_QUALITY } from '../src/utils/gptImage2.mjs';
import { isExternallyReachableBaseUrl } from '../src/utils/publicNetworkUrl.mjs';
import {
  buildAssetPublicPath,
  collectStoredAssetIdsFromValue,
  ensureAssetSchema,
  extractStoredAssetIdFromPublicUrl,
  fetchRemoteAssetBufferWithRetry,
  getVoiceoverIntermediateExpiresAt,
  getPublicBaseUrl,
  getActiveManagedAssetRunIds,
  getStoredAssetById,
  getStoredAssetDeleteGraceMs,
  getStoredAssetStorageProvider,
  listAllStoredAssets,
  listAllStoredAssetsForUser,
  listStoredAssets,
  listStoredAssetsForUser,
  markStoredAssetAccessed,
  markStoredAssetDeleted,
  normalizeStoredAssetJobId,
  persistAssetBuffer,
  persistAssetFile,
  persistUploadedAssetBuffer,
  persistInlineImageResult,
  persistRemoteAsset,
  requestStoredAssetDeletion,
  resolveStoredAssetPath,
  selectExpiredAssetsForCleanup,
  selectAbandonedPermanentAgentResultAssets,
} from './assetStore.mjs';
import {
  createVoiceoverChildJobLedger,
} from './voiceoverChildJobStore.mjs';
import {
  getVoiceoverConfig,
} from './voiceoverContract.mjs';
import {
  checkVoiceoverSeparationReadiness,
  separateVoiceover,
} from './voiceoverSeparation.mjs';
import {
  alignVoiceoverGroups,
  buildVocalOnlyAnalysisVideo,
  extractVoiceoverAudio,
  mixVoiceoverResult,
} from './voiceoverAudio.mjs';
import {
  getVoiceoverSourceMaxBytes,
  prepareVoiceoverSubmission as prepareVoiceoverSubmissionInput,
  runVoiceoverTranslationJob,
  streamVoiceoverAssetToFile,
  withVoiceoverProbeWorkspace,
} from './voiceoverTranslationRunner.mjs';
import {
  createVirtualModelDraft,
  createVirtualModelGenerationJobSnapshot,
  createVirtualModelVersion,
  ensureVirtualModelSchema,
  findOwnedHistoricalVirtualModelSnapshot,
  getPublishedVirtualModelDetail,
  listAdminVirtualModels,
  listPublishedVirtualModels,
  normalizeVirtualModelLocalStore,
  publishVirtualModelVersion,
  replaceDraftVersionAssets,
  resolveHistoricalVirtualModelSelectedAssets,
  toVirtualModelPublicSummary,
  unpublishVirtualModel,
  updateVirtualModelDraft,
} from './virtualModelStore.mjs';
import {
  handleVirtualModelDeleteApiRequest,
  respondVirtualModelApiError,
} from './virtualModelHttpApi.mjs';
import { resolveManagedAssetReadUrl } from './managedAssetReadResolver.mjs';
import {
  getManagedAssetAccessKeyFromUrl,
  stripManagedAssetAccessKey,
  verifyManagedAssetAccessKey,
} from './managedAssetAccessKey.mjs';
import {
  enqueueAssetCleanupTask,
  pruneAssetCleanupTasks,
  summarizeAssetCleanupStore,
} from './assetLifecycleStore.mjs';
import { assertOwnedActiveManagedAssetReferences } from './managedAssetReferencePolicy.mjs';
import { scrubUnavailableExplicitManagedAssetIds } from './managedAssetStateScrub.mjs';
import { createTombstonedStateScanTracker, reconcileTombstonedJobs, shouldAlertTombstonedJobCleanup } from './tombstonedJobReconciler.mjs';
import {
  assertManagedAssetSubmissionUserContext,
  assertManagedImageInputsPreserved,
} from './managedAssetSubmissionGuard.mjs';
import {
  getManagedImageMaxBytes,
  inspectManagedImageMultipartPrefix,
  resolveManagedImageUpload,
} from './managedImageValidation.mjs';
import { processAssetCleanupBatch, reconcileManagedAssetStorage } from './assetCleanupWorker.mjs';
import { createMediaTranscodeApi } from './mediaTranscodeApi.mjs';
import { createMediaTranscodeService } from './mediaTranscodeService.mjs';
import { createMediaTranscodeSessionStore } from './mediaTranscodeSessionStore.mjs';
import { createMediaTranscodeError } from './mediaTranscodeContract.mjs';
import { getSubtitleRemovalConfig } from './subtitleRemovalContract.mjs';
import { createVideoDiagnosisProbe } from './videoDiagnosisProbe.mjs';
import { checkDreaminaLogin, getDreaminaStatus, logoutDreamina, startDreaminaLogin } from './dreaminaCli.mjs';
import { createTemporalTaskAdapter } from './temporalTaskAdapter.mjs';
import { getWorkerHealthSnapshot } from './workerHealth.mjs';
import {
  getManagedImageProbeIntervalMs,
  getManagedImageUploadHealth,
  writeManagedImageProbeStatus,
} from './managedImageUploadHealth.mjs';
import { runManagedImageCosProbe } from '../scripts/probe-managed-image-cos.mjs';
import { createLocalTemporalActivities, createMysqlTemporalActivities, startMeiaoTemporalWorker } from './temporalWorker.mjs';
import { buildImageOutputTransformFromJob, transformImageOutputBuffer } from './imagePostProcess.mjs';
import { createProviderCompletedImageOutputRejectedError } from './imageOutputContract.mjs';
import {
  buildReadyImageCheckpoint,
  buildSubmittedImageTaskCheckpoint,
} from './agentChatCheckpointMetadata.mjs';
import {
  getSmartFactoryPreviewConfig,
  runSmartFactoryPreviewTurn,
  testSmartFactoryKnowledgeSearch,
  testSmartFactoryModelProviderConnection,
} from './smartFactoryPreview.mjs';
import {
  addSmartFactoryKnowledgeDocument,
  createDefaultSmartFactoryConfig,
  createSmartFactoryAgent,
  createSmartFactoryKnowledgeBase,
  deleteSmartFactoryAgent,
  deleteSmartFactoryKnowledgeBase,
  deleteSmartFactoryKnowledgeDocument,
  deleteSmartFactoryTool,
  mergeSmartFactoryConfigUpdate,
  normalizeSmartFactoryConfig,
  publishSmartFactoryAgent,
  retrainSmartFactoryKnowledgeDocument,
  updateSmartFactoryAgent,
  updateSmartFactoryKnowledgeBase,
  upsertSmartFactoryTool,
} from './smartFactoryConfigStore.mjs';
import {
  buildAgentCenterSyncPlan,
  buildFactoryAdoptionPlan,
  buildSmartFactoryLinkMarker,
  cleanFactoryId,
  findLinkedAgentCenterAgent,
  findLinkedKnowledgeBase,
  isFactoryManagedAgent,
  stripFactoryMarkerLines,
  SYNC_ERROR_CODES,
  VALIDATION_PROBE_MESSAGE,
} from './smartFactoryAgentBridge.mjs';
import {
  createDefaultModelProviderRegistry,
  deleteModelProvider,
  extractSmartFactoryModelProvidersForMigration,
  getModelProviderPresets,
  getPublicModelProviderRegistry,
  mergeModelProviderRegistryUpdate,
  normalizeModelProviderRegistry,
  upsertModelProvider,
} from './modelProviderRegistry.mjs';
import { resolveModelForNeed } from './modelDispatch.mjs';
import {
  maybeTrainSmartFactoryKnowledgeBaseEmbeddings,
  maybeTrainSmartFactoryKnowledgeDocumentEmbeddings,
} from './smartFactoryKnowledgeTraining.mjs';
import { runAllowedCliTool } from './ai-engine/cliToolRunner.mjs';
import { runBuiltinMediaTool } from './ai-engine/smartFactoryMediaToolRunner.mjs';
import { appendSmartFactoryConversationTurn } from './ai-engine/smartFactoryAgentStore.mjs';
import { ensureLocalAdminUser } from './localAdminBootstrap.mjs';
import { getCreditAlertSnapshot } from './creditAlert.mjs';
import { canRecoverProviderTaskById, getJobSubmissionLockTimeoutSeconds, resolveJobSubmissionPolicy, VIDEO_JOB_TASK_TYPES } from './jobSubmissionPolicy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadServerEnvFile({ envPath: path.join(__dirname, '..', '.env.server') });
loadServerEnvFile({ envPath: path.join(__dirname, '..', '.env.local') });
configureServerNetworkRuntime(process.env);
const dataDir = path.join(__dirname, 'data');
const storePath = path.join(dataDir, 'internal-store.json');
const distDir = path.join(__dirname, '..', 'dist');
const { port: PORT, host: BIND_HOST } = resolveServerListenConfig();
const processRelease = getProcessReleaseIdentity();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ASSET_RETENTION_MS = 1000 * 60 * 60 * 24 * 3;
const LOG_RETENTION_MS = 1000 * 60 * 60 * 24 * 7;
const LOG_CLEANUP_INTERVAL_MS = 1000 * 60 * 60;
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const MAX_STATE_BODY_BYTES = 100 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = 1024 * 1024 * 1024;
const MEDIA_TRANSCODE_INPUT_MAX_BYTES = Math.max(
  1,
  Number.parseInt(String(process.env.MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES || ''), 10) || 200 * 1024 * 1024,
);
const MEDIA_TRANSCODE_SESSION_TTL_MS = Math.max(
  1,
  Number.parseInt(String(process.env.MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS || ''), 10) || 30 * 60 * 1000,
);
const MEDIA_TRANSCODE_MAX_SESSIONS = Math.max(
  1,
  Number.parseInt(String(process.env.MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS || ''), 10) || 20,
);
const INTERNAL_ASSET_REGISTRY_KEY = '__assetRegistry';
const ASSET_ACCESS_TOUCH_THROTTLE_MS = 1000 * 60 * 5;
const recentAssetAccessTouches = new Map();

const scheduleStoredAssetAccessTouch = (pool, assetId, touchedAt = Date.now()) => {
  if (!assetId) return;
  const lastTouchedAt = recentAssetAccessTouches.get(assetId) || 0;
  if (touchedAt - lastTouchedAt < ASSET_ACCESS_TOUCH_THROTTLE_MS) return;
  recentAssetAccessTouches.set(assetId, touchedAt);
  if (recentAssetAccessTouches.size > 5000) {
    const cutoff = touchedAt - ASSET_ACCESS_TOUCH_THROTTLE_MS;
    for (const [key, value] of recentAssetAccessTouches) {
      if (value < cutoff) recentAssetAccessTouches.delete(key);
    }
  }
  void markStoredAssetAccessed(pool, assetId, touchedAt).catch((error) => {
    console.warn('[asset-store] failed to touch asset access time', {
      assetId,
      message: error?.message || String(error || ''),
    });
  });
};
const TRACKED_URL_FIELDS = new Set([
  'resultUrl',
  'sourceUrl',
  'uploadedReferenceUrl',
  'uploadedUrl',
  'lastStyleUrl',
  'uploadedLogoUrl',
  'imageUrl',
  'whiteBgImageUrl',
  'previousBoardImageUrl',
]);

const formatSmartFactoryToolMessagesForTest = (messages = []) => (Array.isArray(messages) ? messages : [])
  .map((item) => {
    const type = String(item?.type || 'text');
    const text = String(item?.message?.text || item?.text || '').trim();
    if (!text) return '';
    return type === 'link' ? `result link: ${text}` : text;
  })
  .filter(Boolean)
  .join('\n');

const TRACKED_URL_ARRAY_FIELDS = new Set(['uploadedProductUrls', 'veoReferenceImages']);
const NULLABLE_TRACKED_FIELDS = new Set(['uploadedReferenceUrl', 'lastStyleUrl', 'uploadedLogoUrl', 'whiteBgImageUrl']);

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const dbConfig = {
  host: process.env.MEIAO_DB_HOST || '',
  port: Number(process.env.MEIAO_DB_PORT || 3306),
  user: process.env.MEIAO_DB_USER || '',
  password: process.env.MEIAO_DB_PASSWORD || '',
  database: process.env.MEIAO_DB_NAME || '',
};

const shouldUseMysql = Boolean(
  dbConfig.host &&
  dbConfig.user &&
  dbConfig.password &&
  dbConfig.database
);

let mysql = null;
let mysqlPool = null;
let mysqlManagedAssetLockPool = null;
let mysqlPoolHealthCheckPromise = null;
let warnedAppStateBinlogDisableFailure = false;
let jobWorker = null;
let localJobWorker = null;
let temporalWorkerRuntime = null;
let localStoreCache = null;
let assetCleanupTimer = null;
let assetCleanupRunning = false;
let managedImageProbeTimer = null;
let managedImageProbeRunning = false;
let tombstonedJobReconcilerTimer = null;
let tombstonedJobReconcilerRunning = false;
let lastManagedCosReconciliationAt = 0;
let managedAssetCleanup = {
  backlog: 0,
  oldestPendingAgeMs: 0,
  retryAttempts: 0,
  manualReview: 0,
  protected: 0,
  complete: 0,
  uploadFailed: 0,
  deletePending: 0,
  uploading: 0,
  activeCosChecked: 0,
  activeCosMissing: 0,
  activeCosHeadFailed: 0,
  alerting: false,
  lastCycleAt: null,
};
let tombstonedJobCleanup = {
  desired: 0,
  found: 0,
  deleted: 0,
  cancelRequested: 0,
  pending: 0,
  errors: 0,
  alerting: false,
  lastError: '',
  lastCycleAt: null,
};
const tombstonedStateScanTracker = createTombstonedStateScanTracker();
let logCleanupTimer = null;
let staleRunningJobReconcilerTimer = null;
const temporalTaskAdapter = createTemporalTaskAdapter();
const mediaTranscodeService = createMediaTranscodeService({ env: process.env });
const mediaTranscodeSessionStore = createMediaTranscodeSessionStore({
  rootDir: path.join(dataDir, 'media-transcode-sessions'),
  ttlMs: MEDIA_TRANSCODE_SESSION_TTL_MS,
  maxSessions: MEDIA_TRANSCODE_MAX_SESSIONS,
});
let mediaTranscodeReadiness = {
  enabled: mediaTranscodeService.getStatus().enabled,
  ffmpegReady: false,
  ffprobeReady: false,
};
let voiceoverTranslationReadiness = {
  ready: false,
  pythonReady: false,
  modelReady: false,
  ffmpegReady: false,
};
const mediaTranscodeApi = createMediaTranscodeApi({
  store: mediaTranscodeSessionStore,
  service: mediaTranscodeService,
  persistAsset: async ({ userId, module, assetType, fileBuffer, fileName, mimeType, metadata }) => {
    const persist = async (pool) => persistAssetBuffer({
      pool: pool || null,
      publicBaseUrl: getPersistentAssetBaseUrl(),
      userId,
      module,
      assetType,
      originalName: fileName,
      mimeType,
      fileBuffer,
      width: metadata?.width || 0,
      height: metadata?.height || 0,
      provider: 'internal_transcode',
    });
    let persisted;
    if (shouldUseMysql) {
      persisted = await withManagedAssetUserLock(userId, async (pool) => {
        await assertActiveDbUserUnderManagedAssetLock(pool, userId, '账号已停用或不存在，未保存转码结果');
        return persist(pool);
      });
    } else {
      persisted = await withLocalManagedAssetUserLock(userId, async () => {
        const owner = findLocalUserById(userId);
        if (!owner || owner.status !== 'active') {
          const error = new Error('账号已停用或不存在，未保存转码结果');
          error.code = 'managed_asset_owner_unavailable';
          error.statusCode = 409;
          throw error;
        }
        return persist(null);
      });
    }
    return {
      assetId: persisted.id,
      url: persisted.publicUrl,
      fileUrl: persisted.publicUrl,
    };
  },
  log: (entry) => console.info('[media-transcode]', entry),
});

const defaultApiConfig = {
  kieApiKey: '',
  concurrency: 5,
};

const DEFAULT_JOB_CONCURRENCY = 5;
const DEFAULT_FEATURE_PERMISSIONS = Object.freeze({
  videoGeneration: false,
});

const defaultModuleConfig = {
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: 'auto',
  quality: '1k',
  model: 'gpt-image-2',
  resolutionMode: 'custom',
  targetWidth: 1200,
  targetHeight: 1200,
  maxFileSize: 2.0,
};

const defaultTranslationConfigs = {
  main: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: '1:1',
    quality: '1k',
    model: 'gpt-image-2',
    resolutionMode: 'custom',
    targetWidth: 800,
    targetHeight: 800,
    maxFileSize: 2.0,
  },
  detail: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: 'auto',
    quality: '1k',
    model: 'gpt-image-2',
    resolutionMode: 'custom',
    targetWidth: 750,
    targetHeight: 0,
    maxFileSize: 2.0,
  },
  removeText: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: 'auto',
    quality: '1k',
    model: 'gpt-image-2',
    resolutionMode: 'custom',
    targetWidth: 1200,
    targetHeight: 0,
    maxFileSize: 2.0,
  },
};

const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';
const MANAGED_ASSET_REFERENCE_PATTERN = /(?:https?:\/\/[^\s"'<>，。；;、)）]+)?\/api\/assets\/file\/[^/?#"'\s<>，。；;、)）]+(?:\/[^?#"'\s<>，。；;、)）]+)?/g;
const ASSET_FILE_ROUTE_REGEX = /^\/api\/assets\/file\/([^/]+)(?:\/[^/]+)?$/;
const ASSET_X_ACCEL_PREFIX = '/__meiao_stored_assets';
const ASSET_CLEANUP_INTERVAL_MS = Math.max(
  60_000,
  Number.parseInt(String(process.env.MEIAO_ASSET_CLEANUP_INTERVAL_MS || 1000 * 60 * 30), 10) || 1000 * 60 * 30,
);
const TOMBSTONED_JOB_RECONCILE_INTERVAL_MS = Math.max(
  5_000,
  Math.min(
    5 * 60 * 1000,
    Number.parseInt(String(process.env.MEIAO_TOMBSTONED_JOB_RECONCILE_INTERVAL_MS || 15_000), 10) || 15_000,
  ),
);
const TOMBSTONED_JOB_PENDING_ALERT_MS = Math.max(
  60_000,
  Number.parseInt(String(process.env.MEIAO_TOMBSTONED_JOB_PENDING_ALERT_MS || 15 * 60 * 1000), 10)
    || 15 * 60 * 1000,
);
const ASSET_CLEANUP_BATCH_SIZE = Math.max(
  1,
  Math.min(200, Number.parseInt(String(process.env.MEIAO_ASSET_CLEANUP_BATCH_SIZE || 20), 10) || 20),
);
const ASSET_CLEANUP_LEASE_MS = Math.max(
  60_000,
  Math.min(3_600_000, Number.parseInt(String(process.env.MEIAO_ASSET_CLEANUP_LEASE_MS || 600_000), 10) || 600_000),
);
const ASSET_CLEANUP_ALERT_BACKLOG = Math.max(
  1,
  Number.parseInt(String(process.env.MEIAO_ASSET_CLEANUP_ALERT_BACKLOG || 100), 10) || 100,
);
const ASSET_CLEANUP_ALERT_OLDEST_MS = Math.max(
  60_000,
  Number.parseInt(String(process.env.MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS || 86_400_000), 10) || 86_400_000,
);
const ASSET_COS_RECONCILE_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Math.min(
    7 * 24 * 60 * 60 * 1000,
    Number.parseInt(String(process.env.MEIAO_ASSET_COS_RECONCILE_INTERVAL_MS || 86_400_000), 10) || 86_400_000,
  ),
);
const DOWNLOAD_PROXY_TIMEOUT_MS = 30_000;
const DOWNLOAD_PROXY_MAX_BYTES = 80 * 1024 * 1024;

const isLocalHostValue = (value) => /(^|\/\/)(127\.0\.0\.1|localhost)(:|$)/i.test(String(value || ''));

const isPrivateIpv4Hostname = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || a === 127
    || a === 0;
};

const normalizeDownloadProxyUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('下载地址无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 HTTP/HTTPS 下载地址');
  }
  const hostname = parsed.hostname.toLowerCase();
  const ipVersion = isIP(hostname);
  const blocked = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || (ipVersion === 4 && isPrivateIpv4Hostname(hostname))
    || (ipVersion === 6 && (
      hostname === '::1'
      || hostname.startsWith('fc')
      || hostname.startsWith('fd')
      || hostname.startsWith('fe80:')
    ));
  if (blocked) {
    throw new Error('下载地址不能指向本机或内网地址');
  }
  parsed.hash = '';
  return parsed.toString();
};

const proxyRemoteDownload = async (req, res, remoteUrl) => {
  let normalizedUrl;
  try {
    normalizedUrl = normalizeDownloadProxyUrl(remoteUrl);
  } catch (error) {
    json(res, 400, { message: error?.message || '下载地址无效' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_PROXY_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(normalizedUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/*,application/octet-stream,*/*;q=0.8',
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error?.name === 'AbortError' ? '下载远程图片超时' : '下载远程图片失败';
    json(res, 502, { message });
    return;
  }

  if (!response.ok) {
    clearTimeout(timeout);
    json(res, response.status >= 400 && response.status < 600 ? response.status : 502, {
      message: `远程图片下载失败: ${response.status}`,
    });
    return;
  }

  const declaredLength = Number.parseInt(String(response.headers.get('content-length') || '0'), 10);
  if (Number.isFinite(declaredLength) && declaredLength > DOWNLOAD_PROXY_MAX_BYTES) {
    clearTimeout(timeout);
    json(res, 413, { message: '远程图片过大，无法下载' });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    clearTimeout(timeout);
    const message = error?.name === 'AbortError' ? '下载远程图片超时' : '读取远程图片失败';
    json(res, 502, { message });
    return;
  }
  clearTimeout(timeout);
  if (buffer.length > DOWNLOAD_PROXY_MAX_BYTES) {
    json(res, 413, { message: '远程图片过大，无法下载' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...(res.__corsHeaders || {}),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
};

const getPersistentAssetBaseUrl = (req = null) => {
  const explicit = getPublicBaseUrl(process.env, null);
  if (explicit) return explicit;

  const inferred = getPublicBaseUrl({}, req);
  if (!inferred) return '';
  if (!shouldUseMysql) return inferred;
  if (isLocalHostValue(inferred)) return '';
  return inferred;
};

const isManagedAssetUrl = (value) => typeof value === 'string' && value.includes(MANAGED_ASSET_PATH_SEGMENT);

const isAvailableManagedAssetUrl = (value, validAssetUrls) => {
  if (!isManagedAssetUrl(value)) return true;
  if (validAssetUrls.has(value)) return true;
  const assetId = extractStoredAssetIdFromPublicUrl(value);
  return Boolean(assetId && validAssetUrls.has(assetId));
};

const scrubUnavailableManagedAssetString = (value, validAssetUrls) => {
  if (!isManagedAssetUrl(value)) return value;
  let removedCount = 0;
  const nextValue = value.replace(MANAGED_ASSET_REFERENCE_PATTERN, (match) => {
    if (isAvailableManagedAssetUrl(match, validAssetUrls)) return match;
    removedCount += 1;
    return '';
  });
  if (removedCount === 0) {
    return isAvailableManagedAssetUrl(value, validAssetUrls) ? value : undefined;
  }
  return nextValue.trim() ? nextValue : undefined;
};

const collectManagedAssetUrls = (value, bucket = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectManagedAssetUrls(item, bucket));
    return bucket;
  }
  if (!value || typeof value !== 'object') {
    if (isManagedAssetUrl(value)) {
      bucket.add(value);
    }
    return bucket;
  }

  Object.values(value).forEach((child) => collectManagedAssetUrls(child, bucket));
  return bucket;
};

const scrubUnavailableManagedAssetUrls = (value, validAssetUrls) => {
  if (Array.isArray(value)) {
    return value.map((item) => scrubUnavailableManagedAssetUrls(item, validAssetUrls)).filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return scrubUnavailableManagedAssetString(value, validAssetUrls);
    return isManagedAssetUrl(value) && !isAvailableManagedAssetUrl(value, validAssetUrls) ? undefined : value;
  }

  const next = {};
  const hadUnavailableUploadedUrl =
    isManagedAssetUrl(value.uploadedUrl) &&
    !isAvailableManagedAssetUrl(value.uploadedUrl, validAssetUrls);
  for (const [key, child] of Object.entries(value)) {
    const cleaned = scrubUnavailableManagedAssetUrls(child, validAssetUrls);
    next[key] = cleaned === undefined ? (NULLABLE_TRACKED_FIELDS.has(key) ? null : Array.isArray(child) ? [] : undefined) : cleaned;
  }
  if (hadUnavailableUploadedUrl && (value.role === 'product' || value.role === 'gift' || value.role === 'style_ref')) {
    return undefined;
  }
  if (value.type === 'image_url' && (!next.image_url || !next.image_url.url)) {
    return undefined;
  }
  return next;
};

const scrubUnavailableManagedAssetStateReferences = (value, validAssetReferences) => (
  scrubUnavailableExplicitManagedAssetIds(
    scrubUnavailableManagedAssetUrls(value, validAssetReferences),
    validAssetReferences,
  )
);

const buildValidManagedAssetReferences = (assets = []) => {
  const refs = new Set();
  for (const asset of assets || []) {
    if (!asset || asset.deletedAt) continue;
    if (asset.storageStatus && asset.storageStatus !== 'active') continue;
    if (!asset.storageKey) continue;
    if (getStoredAssetStorageProvider(asset) === 'internal' && !existsSync(resolveStoredAssetPath(asset))) continue;
    if (asset.publicUrl) refs.add(asset.publicUrl);
    if (asset.id) refs.add(String(asset.id));
  }
  return refs;
};

const reindexImageReferences = (imageReferences = []) => (Array.isArray(imageReferences) ? imageReferences : [])
  .map((item, index) => ({
    ...item,
    index: index + 1,
    label: `图${index + 1}`,
  }));

const isProviderTemporaryImageUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    return hostname === 'tempfile.redpandaai.co'
      || hostname === 'tempfileb.aiquickdraw.com'
      || hostname.endsWith('.tempfile.redpandaai.co')
      || hostname.endsWith('.tempfileb.aiquickdraw.com')
      || /\/openrouter-chat\//i.test(url.pathname);
  } catch {
    return false;
  }
};

const filterAvailableConversationImageReferences = async (imageReferences = [], userId = '') => {
  const refs = (Array.isArray(imageReferences) ? imageReferences : [])
    .filter((item) => !(item?.source !== 'current_upload' && isProviderTemporaryImageUrl(item?.url)));
  if (!refs.some((item) => isManagedAssetUrl(item?.url))) return reindexImageReferences(refs);

  try {
    const pool = shouldUseMysql ? await getMysqlPool() : null;
    const assets = await listStoredAssetsForUser(pool, userId);
    const validAssetRefs = buildValidManagedAssetReferences(assets);
    return reindexImageReferences(refs.filter((item) => !isManagedAssetUrl(item?.url) || isAvailableManagedAssetUrl(item.url, validAssetRefs)));
  } catch {
    return reindexImageReferences(refs);
  }
};

const sanitizePathPart = (value) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'anonymous';
const sanitizeUploadFileName = (value) => {
  const raw = String(value || 'upload.bin').trim() || 'upload.bin';
  const ext = path.extname(raw).slice(0, 16);
  const base = path.basename(raw, ext) || 'upload';
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'upload';
  const safeExt = ext.replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16);
  return `${safeBase}${safeExt}`;
};

const createDefaultState = () => ({
  activeModule: 'one_click',
  apiConfig: defaultApiConfig,
  moduleConfig: defaultModuleConfig,
  translationConfigs: defaultTranslationConfigs,
  translationMemory: {
    main: { files: [], isProcessing: false },
    detail: { files: [], isProcessing: false },
    removeText: { files: [], isProcessing: false },
  },
  oneClickMemory: {
    mainImage: {
      productImages: [],
      logoImage: null,
      uploadedLogoUrl: null,
      styleImage: null,
      schemes: [],
      config: {
        description: '',
        platformType: 'domestic',
        platform: '淘宝',
        language: '中文',
        count: 3,
        aspectRatio: '1:1',
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
    },
    detailPage: {
      productImages: [],
      logoImage: null,
      uploadedLogoUrl: null,
      styleImage: null,
      schemes: [],
      config: {
        description: '',
        platformType: 'domestic',
        platform: '淘宝',
        language: '中文',
        count: 7,
        aspectRatio: 'auto',
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
    },
  },
  retouchMemory: {
    tasks: [],
    pendingFiles: [],
    referenceImage: null,
    uploadedReferenceUrl: null,
    mode: 'white_bg',
    aspectRatio: 'auto',
    quality: '1k',
    model: 'gpt-image-2',
    resolutionMode: 'original',
    targetWidth: 0,
    targetHeight: 0,
  },
  buyerShowMemory: {
    subMode: 'integrated',
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
    aspectRatio: '3:4',
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
  },
  videoMemory: {
    subMode: 'long_video',
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
        aspectRatio: '9:16',
        duration: '15s',
        shotCount: 9,
        actorType: 'no_real_face',
        projectCount: 1,
        scenes: [''],
        countryLanguage: '中国/中文',
        generateWhiteBg: false,
        model: 'gpt-image-2',
        quality: GPT_IMAGE_2_DEFAULT_QUALITY,
      },
      projects: [],
      downloadingProjectId: null,
    },
  },
});

const createDefaultSystemSettings = () => ({
  analysisModel: '',
  videoAnalysisModel: '',
  announcement: {
    id: '',
    title: '',
    content: '',
    enabled: false,
    updatedAt: 0,
    updatedBy: '',
  },
  openaiCompatible: {
    apiKey: '',
    baseUrl: '',
    models: '',
  },
  modelProviders: createDefaultModelProviderRegistry(),
  smartFactory: createDefaultSmartFactoryConfig(),
});

const normalizeOpenAICompatibleSettings = (value = {}) => ({
  apiKey: String(value?.apiKey || '').trim(),
  baseUrl: String(value?.baseUrl || '').trim().replace(/\/$/, ''),
  models: String(value?.models || '').trim(),
});

const createEmptySystemAnnouncement = () => ({
  id: '',
  title: '',
  content: '',
  enabled: false,
  updatedAt: 0,
  updatedBy: '',
});

const normalizeSystemAnnouncement = (value = {}) => {
  const title = String(value?.title || '').trim().slice(0, 120);
  const content = String(value?.content || '').trim().slice(0, 4000);
  const enabled = Boolean(value?.enabled);
  if (!enabled || !title || !content) return createEmptySystemAnnouncement();
  const updatedAt = Number(value?.updatedAt || 0);
  return {
    id: String(value?.id || '').trim().slice(0, 80),
    title,
    content,
    enabled: true,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    updatedBy: String(value?.updatedBy || '').trim().slice(0, 120),
  };
};

const normalizeSystemSettings = (value = {}) => {
  const analysisModel = String(value?.analysisModel || '').trim();
  const videoAnalysisModel = String(value?.videoAnalysisModel || '').trim();
  const available = new Set(getChatModelCatalog().map((item) => item.id));
  const videoAvailable = new Set(getChatModelCatalog().filter((item) => String(item.id || '').toLowerCase().startsWith('gemini')).map((item) => item.id));
  const modelProviders = normalizeModelProviderRegistry(
    value?.modelProviders || extractSmartFactoryModelProvidersForMigration(value),
  );
  return {
    analysisModel: analysisModel && available.has(analysisModel) ? analysisModel : '',
    videoAnalysisModel: videoAnalysisModel && videoAvailable.has(videoAnalysisModel) ? videoAnalysisModel : '',
    announcement: normalizeSystemAnnouncement(value?.announcement || {}),
    openaiCompatible: normalizeOpenAICompatibleSettings(value?.openaiCompatible || {}),
    modelProviders,
    smartFactory: normalizeSmartFactoryConfig(value?.smartFactory || {}),
  };
};

const composeSmartFactoryConfigForRuntime = (systemSettings = {}) => (
  normalizeSmartFactoryConfig({
    ...(systemSettings?.smartFactory || {}),
    modelProviders: normalizeModelProviderRegistry(systemSettings?.modelProviders).providers,
  })
);

// 本地 JSON 模式:验证辅助函数——复用于验证路由和发布管道。
// 成功返回 { ok: true, version, result };失败返回 { ok: false, errorMessage }。
const validateLocalAgentVersionRecord = async (store, user, agent, version, message) => {
  const rawVersion = store.agentVersions.find((item) => item.id === version.id);
  if (!rawVersion) return { ok: false, errorMessage: '版本记录不存在' };
  try {
    const result = await runLocalAgentConversation({
      store,
      user,
      agent,
      version,
      priorMessages: [],
      currentMessage: String(message || '请用一句话说明这个智能体能做什么。'),
    });
    rawVersion.validationStatus = 'success';
    rawVersion.validationSummary = {
      ...result,
      outputPreview: result.content.slice(0, 300),
      validatedAt: Date.now(),
    };
    store.agentUsageLogs.push({
      id: createEntityId(),
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      agentId: agent.id,
      agentName: agent.name,
      agentVersionId: version.id,
      sessionId: null,
      requestType: 'validation',
      selectedModel: result.selectedModel,
      usedRetrieval: result.usedRetrieval,
      retrievalSummaryJson: result.retrievalSummary,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
      status: 'success',
      errorMessage: '',
      createdAt: Date.now(),
    });
    appendLocalLog(store, {
      user,
      level: 'info',
      module: 'agent_center',
      action: 'agent_validate',
      message: `智能体验证：${agent.name}`,
      status: 'success',
      meta: buildAgentRuntimeLogMeta({ agent, version, result, requestMode: 'validation' }),
    });
    return { ok: true, version: getLocalAgentVersionById(store, version.id), result: rawVersion.validationSummary };
  } catch (error) {
    rawVersion.validationStatus = 'failed';
    appendLocalLog(store, {
      user,
      level: 'error',
      module: 'agent_center',
      action: 'agent_validate',
      message: `智能体验证失败：${agent.name}`,
      detail: error?.message || '智能体验证失败。',
      status: 'failed',
      meta: buildAgentRuntimeLogMeta({ agent, version, requestMode: 'validation', error }),
    });
    return { ok: false, errorMessage: error?.message || '智能体验证失败。' };
  }
};

// 本地 JSON 模式:上线辅助函数——复用于上线路由和发布管道。
// 路由层的 404/400 校验留在路由,此函数仅执行翻牌动作。
const publishLocalAgentVersionRecord = (store, agentId, versionId) => {
  store.agentVersions.forEach((item) => {
    if (item.agentId === agentId) item.isPublished = item.id === versionId;
  });
  const rawAgent = store.agents.find((item) => item.id === agentId);
  if (rawAgent) {
    rawAgent.currentVersionId = versionId;
    rawAgent.status = 'published';
    rawAgent.updatedAt = Date.now();
  }
};

// 阶段4.5 中心侧编辑锁:工厂出品 agent 禁改内容(人设/模型/知识库/版本)。
// 上下线(publish/rollback)、停启用(status-only PATCH)、删除、验证、会话聊天不经此守卫。
// 空 body 也放行(空对象 every 为 true,落到既有校验),不视为内容编辑。
const isStatusOnlyAgentPatch = (payload = {}) => (
  Object.keys(payload || {}).every((key) => key === 'status')
);

// 判据单一来源:bridge 的 isFactoryManagedAgent(结构化字段优先,旧 marker 前缀回退)。
// 返回 true 表示已拒绝并写响应,调用方应立即 return。
const rejectIfFactoryManaged = (res, agent) => {
  if (!isFactoryManagedAgent(agent)) return false;
  json(res, 403, {
    errorCode: 'factory_managed_agent',
    message: '该智能体由智能工厂管理，请在智能工厂修改后重新发布。',
  });
  return true;
};

// 工厂删除 agent 时的级联:中心侧只下线+解除工厂锁定,不物理删除(商家会话历史保留)。
// 解锁必须同时清结构化字段和 description 旧标记行——编辑锁判据(isFactoryManagedAgent)有
// description 前缀回退,漏清会让锁复活。stripFactoryMarkerLines 在 bridge 单一实现,
// 前缀常量不在 index 引用(编辑锁测试已锁该不变量)。
const unpublishLinkedAgentCenterAgentLocal = (store, factoryAgentId) => {
  const linked = findLinkedAgentCenterAgent(store.agents || [], factoryAgentId);
  if (!linked) return null;
  const rawAgent = (store.agents || []).find((item) => item.id === linked.id);
  if (!rawAgent) return null;
  rawAgent.status = 'draft';
  rawAgent.factoryAgentId = '';
  rawAgent.description = stripFactoryMarkerLines(rawAgent.description);
  rawAgent.updatedAt = Date.now();
  return { agentCenterAgentId: linked.id, unpublished: true };
};

const unpublishLinkedAgentCenterAgentDb = async (factoryAgentId) => {
  const pool = await getMysqlPool();
  const linked = await findDbLinkedAgentByFactoryId(pool, factoryAgentId);
  if (!linked) return null;
  await pool.query(
    "UPDATE agents SET status = 'draft', factory_agent_id = NULL, description = ?, updated_at = ? WHERE id = ?",
    [stripFactoryMarkerLines(linked.description), Date.now(), linked.id]
  );
  return { agentCenterAgentId: linked.id, unpublished: true };
};

// 阶段5 工厂→智能体中心同步桥(执行层)。发布成功后调用;同步失败绝不回滚发布,
// 只把 syncError 带回响应。仅 admin 触发(工厂路由只有登录守卫,避免权限放大)。
// 两种模式各一份执行器(根因库#7),纯计划构建在 smartFactoryAgentBridge.mjs 单一实现。
const syncFactoryAgentToLocalAgentCenter = async (store, user, smartFactoryConfig, factoryAgentId) => {
  if (user?.role !== 'admin') return { synced: false, skipped: 'not_admin' };
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  const factoryAgent = normalized.agents.find((agent) => agent.id === factoryAgentId);
  const plan = buildAgentCenterSyncPlan({ factoryAgent, factoryConfig: normalized });
  if (!plan) return { synced: false, skipped: 'no_plan' };

  // 1) 物化/刷新知识库(全量替换文档;刷新走 deleteLocalKnowledgeDocument 级联清 chunk)。
  // 任一步失败即整体 fail-fast 回报(spec §7:不留静默部分成功)。
  // 半刷新状态可自愈:重跑发布会对每个 KB 全量重删重写,不会残留部分刷新状态。
  // 本地 ingestion 大多吞错降级,MySQL 版每步真会抛,必须保持同样的 fail-fast 结构。
  // 链接查找直接用 bridge 的 findLinkedKnowledgeBase 全量扫描 store——本地 store 本就
  // 无 owner 过滤;MySQL 版因 listDb* 会按 owner 过滤普通 admin,改走定向 SQL 查找(有意不对称)。
  const knowledgeBaseIds = [];
  let currentKbName = '';
  let deletedDocCount = 0;
  try {
    for (const kb of plan.knowledgeBases) {
      currentKbName = kb.name;
      const linked = findLinkedKnowledgeBase(store.knowledgeBases || [], plan.factoryAgentId, kb.factoryKnowledgeBaseId);
      let kbId = linked?.id || '';
      if (kbId) {
        for (const doc of listLocalKnowledgeDocuments(store, user, kbId)) {
          const deleted = deleteLocalKnowledgeDocument(store, user, doc.id);
          if (!deleted) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:文档删除失败(无权限或不存在):${doc.id}` };
          deletedDocCount += 1;
        }
      } else {
        const created = createLocalKnowledgeBase(store, user, { name: kb.name, description: kb.description, department: '智能工厂' });
        if (!created) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:知识库创建失败:${kb.name}` };
        kbId = created.id;
      }
      const rawKb = (store.knowledgeBases || []).find((item) => item.id === kbId);
      if (rawKb) { // 结构化链接(新建)/惰性迁移(旧标记库)
        rawKb.factoryAgentId = plan.factoryAgentId;
        rawKb.factoryKnowledgeBaseId = kb.factoryKnowledgeBaseId;
      }
      knowledgeBaseIds.push(kbId);
      for (const doc of kb.documents) {
        const createdDoc = await createLocalKnowledgeDocument(store, user, { knowledgeBaseId: kbId, title: doc.title, rawText: doc.rawText, sourceType: doc.sourceType });
        if (!createdDoc) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:文档写入失败:${doc.title}` };
      }
    }
  } catch (error) {
    return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:[${currentKbName}] 已删${deletedDocCount}篇文档后失败:${error?.message || error}` };
  }

  // 2) 物化/更新 agent + 新版本
  const existing = findLinkedAgentCenterAgent(store.agents || [], plan.factoryAgentId);
  let agentId = existing?.id || '';
  let version = null;
  if (agentId) {
    const rawAgent = (store.agents || []).find((item) => item.id === agentId);
    if (rawAgent && !rawAgent.factoryAgentId) rawAgent.factoryAgentId = plan.factoryAgentId; // 惰性迁移
    updateLocalAgent(store, user, agentId, { name: plan.agentPayload.name, description: plan.agentPayload.description });
    const draft = createLocalAgentDraft(store, user, agentId);
    if (!draft) return { synced: false, syncError: SYNC_ERROR_CODES.DRAFT_CREATE_FAILED };
    version = updateLocalAgentVersion(store, user, draft.id, {
      systemPrompt: plan.agentPayload.systemPrompt,
      allowedChatModels: plan.agentPayload.allowedChatModels,
      defaultChatModel: plan.agentPayload.defaultChatModel,
      knowledgeBaseIds,
    });
  } else {
    const result = createLocalAgent(store, user, { ...plan.agentPayload, knowledgeBaseIds });
    agentId = result?.agent?.id || '';
    version = result?.version || null;
    const rawAgent = (store.agents || []).find((item) => item.id === agentId);
    if (rawAgent) rawAgent.factoryAgentId = plan.factoryAgentId; // 结构化字段落库
  }
  if (!agentId || !version) return { synced: false, syncError: SYNC_ERROR_CODES.AGENT_MATERIALIZE_FAILED };

  // 3) 自动验证;失败 → 不上线(老版本继续在线),原因回报工厂
  const agent = getLocalAgentById(store, agentId);
  const validation = await validateLocalAgentVersionRecord(store, user, agent, version, VALIDATION_PROBE_MESSAGE);
  writeLocalStore(store);
  if (!validation?.ok) {
    return { synced: true, published: false, agentCenterAgentId: agentId, validationFailed: true, errorMessage: validation?.errorMessage || '验证失败' };
  }

  // 4) 自动上线(持久化由 step 3 的 writeLocalStore 与路由尾部兜底)。
  // publishLocalAgentVersionRecord 是无返回值的纯内存写,没有可失败分支,
  // 所以本地版没有 DB 版的 publish_failed 检查(有意不对称)。
  publishLocalAgentVersionRecord(store, agentId, version.id);
  return { synced: true, published: true, agentCenterAgentId: agentId };
};

// 反向接管(本地):中心存量 agent(无工厂来源)导入工厂,并写 factoryAgentId 关联。
// 只新增工厂侧配置与中心侧关联字段,不改写中心 agent 的版本/会话/知识库内容,
// 也不触发"工厂→中心"同步发布管道(中心本来就是线上态,接管不重发布)。
// 共用知识库(alreadyLinked)只复用工厂侧同一份,不重复导入、不改写既有关联。
const adoptCenterAgentIntoLocalFactory = async (store, user, centerAgentId) => {
  if (user?.role !== 'admin') return { status: 403, body: { message: '仅管理员可接管中心智能体。' } };
  const centerAgent = getLocalAgentById(store, centerAgentId);
  if (!centerAgent) return { status: 404, body: { message: '中心智能体不存在。' } };
  if (isFactoryManagedAgent(centerAgent)) {
    return { status: 409, body: { message: '该智能体已由智能工厂管理,请直接在智能工厂里编辑。' } };
  }
  const versions = listLocalAgentVersionsByAgentId(store, centerAgentId);
  const centerVersion = versions.find((item) => item.id === centerAgent.currentVersionId) || versions[0] || null;
  if (!centerVersion) return { status: 400, body: { message: '该智能体还没有任何版本,无法接管。' } };
  const knowledgeBases = (centerVersion.knowledgeBaseIds || [])
    .map((kbId) => (store.knowledgeBases || []).find((kb) => kb.id === kbId))
    .filter(Boolean)
    .map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      alreadyLinkedFactoryKnowledgeBaseId: kb.factoryKnowledgeBaseId || '',
      documents: (store.knowledgeDocuments || [])
        .filter((document) => document.knowledgeBaseId === kb.id)
        .map((document) => ({ title: document.title, rawText: document.rawText, sourceType: document.sourceType })),
    }));
  const plan = buildFactoryAdoptionPlan({ centerAgent, centerVersion, knowledgeBases });
  if (!plan) return { status: 400, body: { message: '接管计划生成失败。' } };
  const currentLocalSettings = getLocalSystemSettings(store);
  let nextSmartFactory = currentLocalSettings.smartFactory;
  for (const kb of plan.factoryKnowledgeBases) {
    nextSmartFactory = createSmartFactoryKnowledgeBase(nextSmartFactory, { id: kb.id, name: kb.name, description: kb.description });
    for (const document of kb.documents) {
      nextSmartFactory = addSmartFactoryKnowledgeDocument(nextSmartFactory, { knowledgeBaseId: kb.id, document });
    }
    const trainingResult = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(nextSmartFactory, kb.id, { env: process.env });
    nextSmartFactory = trainingResult.config;
  }
  nextSmartFactory = createSmartFactoryAgent(nextSmartFactory, plan.factoryAgentPayload);
  if (plan.publishAfterCreate) nextSmartFactory = publishSmartFactoryAgent(nextSmartFactory, plan.factoryAgentId);
  const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
  const rawAgent = (store.agents || []).find((item) => item.id === centerAgentId);
  if (rawAgent) rawAgent.factoryAgentId = plan.centerLinks.factoryAgentId;
  for (const link of plan.centerLinks.kbLinks) {
    const rawKb = (store.knowledgeBases || []).find((item) => item.id === link.centerKnowledgeBaseId);
    if (rawKb) {
      rawKb.factoryAgentId = plan.centerLinks.factoryAgentId;
      rawKb.factoryKnowledgeBaseId = link.factoryKnowledgeBaseId;
    }
  }
  writeLocalStore(store);
  return {
    status: 200,
    nextSettings,
    body: { adopted: { factoryAgentId: plan.factoryAgentId, agentCenterAgentId: centerAgentId } },
  };
};

// I1:工厂发布是 admin-only 管道,链接判据全局唯一。不能用 listDbAgents/listDbKnowledgeBases
// 做链接查找——它们对普通 admin(非超管名单)按 owner_user_id 过滤,会漏掉其他 admin 物化过的
// 链接记录 → 重复物化。改为定向 SQL:结构化字段优先,无命中回退旧 description marker
// (判据与 bridge 的 findLinkedAgentCenterAgent/findLinkedKnowledgeBase 保持一致)。
const findDbLinkedAgentByFactoryId = async (pool, factoryAgentId) => {
  const id = cleanFactoryId(factoryAgentId);
  if (!id) return null;
  const [byField] = await pool.query(
    'SELECT id FROM agents WHERE factory_agent_id = ? ORDER BY updated_at DESC LIMIT 1',
    [id]
  );
  if (byField[0]) return await getDbAgentById(byField[0].id);
  const [byMarker] = await pool.query(
    'SELECT id FROM agents WHERE description LIKE ? ORDER BY updated_at DESC LIMIT 1',
    [`%${buildSmartFactoryLinkMarker(id)}%`]
  );
  return byMarker[0] ? await getDbAgentById(byMarker[0].id) : null;
};

const findDbLinkedKnowledgeBaseByFactoryId = async (pool, factoryAgentId, factoryKnowledgeBaseId) => {
  const agentId = cleanFactoryId(factoryAgentId);
  const kbId = cleanFactoryId(factoryKnowledgeBaseId);
  if (!agentId || !kbId) return null;
  const [byField] = await pool.query(
    'SELECT id FROM knowledge_bases WHERE factory_agent_id = ? AND factory_kb_id = ? ORDER BY updated_at DESC LIMIT 1',
    [agentId, kbId]
  );
  if (byField[0]) return await getDbKnowledgeBaseById(byField[0].id);
  // 已知限制(与 bridge findLinkedKnowledgeBase 相同):旧 marker 只编码 agentId,
  // 同一 agent 多知识库的历史数据会命中最新一条;存量核实为单 agent 单 KB,不做消歧。
  const [byMarker] = await pool.query(
    'SELECT id FROM knowledge_bases WHERE description LIKE ? ORDER BY updated_at DESC LIMIT 1',
    [`%${buildSmartFactoryLinkMarker(agentId)}%`]
  );
  return byMarker[0] ? await getDbKnowledgeBaseById(byMarker[0].id) : null;
};

const syncFactoryAgentToDbAgentCenter = async (user, smartFactoryConfig, factoryAgentId) => {
  if (user?.role !== 'admin') return { synced: false, skipped: 'not_admin' };
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  const factoryAgent = normalized.agents.find((agent) => agent.id === factoryAgentId);
  const plan = buildAgentCenterSyncPlan({ factoryAgent, factoryConfig: normalized });
  if (!plan) return { synced: false, skipped: 'no_plan' };

  // 1) 物化/刷新知识库(全量替换文档;刷新走 deleteDbKnowledgeDocument 级联清 chunk)。
  // 任一步失败即整体 fail-fast 回报(spec §7:不留静默部分成功)。
  // 半刷新状态可自愈:重跑发布会对每个 KB 全量重删重写,不会残留部分刷新状态。
  // MySQL 每步真会抛,必须 try/catch 整个 KB 段(与本地版对称,本地吞错降级但结构相同)。
  const pool = await getMysqlPool();
  const knowledgeBaseIds = [];
  let currentKbName = '';
  let deletedDocCount = 0;
  try {
    for (const kb of plan.knowledgeBases) {
      currentKbName = kb.name;
      const linked = await findDbLinkedKnowledgeBaseByFactoryId(pool, plan.factoryAgentId, kb.factoryKnowledgeBaseId);
      let kbId = linked?.id || '';
      if (kbId) {
        // 已链接:全量替换文档(deleteDbKnowledgeDocument 级联清 chunk)
        const docs = await listDbKnowledgeDocuments(user, kbId);
        for (const doc of docs) {
          const deleted = await deleteDbKnowledgeDocument(user, doc.id);
          if (!deleted) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:文档删除失败(无权限或不存在):${doc.id}` };
          deletedDocCount += 1;
        }
        // 惰性迁移:补写结构化关联字段(仅当旧库缺失)
        if (!linked.factoryAgentId || !linked.factoryKnowledgeBaseId) {
          await pool.query(
            'UPDATE knowledge_bases SET factory_agent_id = ?, factory_kb_id = ?, updated_at = ? WHERE id = ?',
            [plan.factoryAgentId, kb.factoryKnowledgeBaseId, Date.now(), kbId]
          );
        }
      } else {
        // 新建知识库(factoryAgentId/factoryKnowledgeBaseId 经 INSERT 透传落列)
        const created = await createDbKnowledgeBase(user, {
          name: kb.name,
          description: kb.description,
          department: '智能工厂',
          factoryAgentId: plan.factoryAgentId,
          factoryKnowledgeBaseId: kb.factoryKnowledgeBaseId,
        });
        if (!created) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:知识库创建失败:${kb.name}` };
        kbId = created.id;
      }
      knowledgeBaseIds.push(kbId);
      for (const doc of kb.documents) {
        const createdDoc = await createDbKnowledgeDocument(user, {
          knowledgeBaseId: kbId,
          title: doc.title,
          rawText: doc.rawText,
          sourceType: doc.sourceType,
        });
        if (!createdDoc) return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:文档写入失败:${doc.title}` };
      }
    }
  } catch (error) {
    return { synced: false, syncError: `${SYNC_ERROR_CODES.KB_REFRESH_FAILED}:[${currentKbName}] 已删${deletedDocCount}篇文档后失败:${error?.message || error}` };
  }

  // 2) 物化/更新 agent + 新版本
  const existing = await findDbLinkedAgentByFactoryId(pool, plan.factoryAgentId);
  let agentId = existing?.id || '';
  let version = null;
  if (agentId) {
    // 惰性迁移:补写结构化关联字段(仅当旧 agent 缺失)
    if (!existing.factoryAgentId) {
      await pool.query('UPDATE agents SET factory_agent_id = ?, updated_at = ? WHERE id = ?', [plan.factoryAgentId, Date.now(), agentId]);
    }
    await updateDbAgent(user, agentId, { name: plan.agentPayload.name, description: plan.agentPayload.description });
    const draft = await createDbAgentDraft(user, agentId);
    if (!draft) return { synced: false, syncError: SYNC_ERROR_CODES.DRAFT_CREATE_FAILED };
    version = await updateDbAgentVersion(user, draft.id, {
      systemPrompt: plan.agentPayload.systemPrompt,
      allowedChatModels: plan.agentPayload.allowedChatModels,
      defaultChatModel: plan.agentPayload.defaultChatModel,
      knowledgeBaseIds,
    });
  } else {
    // 新建 agent(factoryAgentId 经 INSERT 透传落列)
    const result = await createDbAgent(user, { ...plan.agentPayload, knowledgeBaseIds });
    agentId = result?.agent?.id || '';
    version = result?.version || null;
  }
  if (!agentId || !version) return { synced: false, syncError: SYNC_ERROR_CODES.AGENT_MATERIALIZE_FAILED };

  // 3) 自动验证;validateDbAgentVersion 会抛错,必须 catch 转 validationFailed
  // 返回 null(权限/找不到)也算失败,与本地版逻辑对称
  let validationResult = null;
  try {
    validationResult = await validateDbAgentVersion(user, version.id, VALIDATION_PROBE_MESSAGE);
  } catch (error) {
    return { synced: true, published: false, agentCenterAgentId: agentId, validationFailed: true, errorMessage: error?.message || '验证时发生错误' };
  }
  if (!validationResult) {
    return { synced: true, published: false, agentCenterAgentId: agentId, validationFailed: true, errorMessage: '验证失败(权限不足或版本不存在)' };
  }

  // 4) 自动上线;publishDbAgentVersion 返回 null 是发布门禁失败(非验证失败),用 syncError 回报
  const published = await publishDbAgentVersion(user, agentId, version.id);
  if (!published) {
    return { synced: true, published: false, agentCenterAgentId: agentId, syncError: 'publish_failed:版本未通过验证或智能体状态异常' };
  }
  return { synced: true, published: true, agentCenterAgentId: agentId };
};

// 反向接管(MySQL):与 adoptCenterAgentIntoLocalFactory 同构(根因#7:双管道同一次改)。
// 文档读取走定向 SQL 而非 listDbKnowledgeDocuments——后者对普通 admin 按 owner 过滤,
// 会静默漏掉其他 admin 名下的文档(与发布管道 I1 的定向 SQL 理由一致)。
const adoptCenterAgentIntoDbFactory = async (user, centerAgentId) => {
  if (user?.role !== 'admin') return { status: 403, body: { message: '仅管理员可接管中心智能体。' } };
  const centerAgent = await getDbAgentById(centerAgentId);
  if (!centerAgent) return { status: 404, body: { message: '中心智能体不存在。' } };
  if (isFactoryManagedAgent(centerAgent)) {
    return { status: 409, body: { message: '该智能体已由智能工厂管理,请直接在智能工厂里编辑。' } };
  }
  const versions = await listDbAgentVersionsByAgentId(centerAgentId);
  const centerVersion = versions.find((item) => item.id === centerAgent.currentVersionId) || versions[0] || null;
  if (!centerVersion) return { status: 400, body: { message: '该智能体还没有任何版本,无法接管。' } };
  const pool = await getMysqlPool();
  const knowledgeBases = [];
  for (const kbId of centerVersion.knowledgeBaseIds || []) {
    const kb = await getDbKnowledgeBaseById(kbId);
    if (!kb) continue;
    const [documentRows] = await pool.query(
      'SELECT title, source_type, raw_text FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY updated_at DESC',
      [kbId]
    );
    knowledgeBases.push({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      alreadyLinkedFactoryKnowledgeBaseId: kb.factoryKnowledgeBaseId || '',
      documents: documentRows.map((row) => ({ title: row.title, rawText: row.raw_text, sourceType: row.source_type })),
    });
  }
  const plan = buildFactoryAdoptionPlan({ centerAgent, centerVersion, knowledgeBases });
  if (!plan) return { status: 400, body: { message: '接管计划生成失败。' } };
  const currentSettings = await getDbSystemSettings();
  let nextSmartFactory = currentSettings.smartFactory;
  for (const kb of plan.factoryKnowledgeBases) {
    nextSmartFactory = createSmartFactoryKnowledgeBase(nextSmartFactory, { id: kb.id, name: kb.name, description: kb.description });
    for (const document of kb.documents) {
      nextSmartFactory = addSmartFactoryKnowledgeDocument(nextSmartFactory, { knowledgeBaseId: kb.id, document });
    }
    const trainingResult = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(nextSmartFactory, kb.id, { env: process.env });
    nextSmartFactory = trainingResult.config;
  }
  nextSmartFactory = createSmartFactoryAgent(nextSmartFactory, plan.factoryAgentPayload);
  if (plan.publishAfterCreate) nextSmartFactory = publishSmartFactoryAgent(nextSmartFactory, plan.factoryAgentId);
  const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
  await pool.query(
    'UPDATE agents SET factory_agent_id = ?, updated_at = ? WHERE id = ?',
    [plan.centerLinks.factoryAgentId, Date.now(), centerAgentId]
  );
  for (const link of plan.centerLinks.kbLinks) {
    await pool.query(
      'UPDATE knowledge_bases SET factory_agent_id = ?, factory_kb_id = ?, updated_at = ? WHERE id = ?',
      [plan.centerLinks.factoryAgentId, link.factoryKnowledgeBaseId, Date.now(), link.centerKnowledgeBaseId]
    );
  }
  return {
    status: 200,
    nextSettings,
    body: { adopted: { factoryAgentId: plan.factoryAgentId, agentCenterAgentId: centerAgentId } },
  };
};

const buildOpenAICompatibleRuntimeEnv = (env, systemSettings = {}) => {
  const openaiCompatible = normalizeOpenAICompatibleSettings(systemSettings?.openaiCompatible || {});
  return {
    ...env,
    ...(openaiCompatible.apiKey ? { OPENAI_COMPATIBLE_API_KEY: openaiCompatible.apiKey } : {}),
    ...(openaiCompatible.baseUrl ? { OPENAI_COMPATIBLE_BASE_URL: openaiCompatible.baseUrl } : {}),
    ...(openaiCompatible.models ? { OPENAI_COMPATIBLE_MODELS: openaiCompatible.models } : {}),
  };
};

const isValidChatwootAiWebhookSecret = (req, url) => {
  const expected = String(process.env.MEIAO_CHATWOOT_AI_WEBHOOK_SECRET || process.env.CHATWOOT_AI_WEBHOOK_SECRET || '').trim();
  if (!expected) return true;
  const supplied = String(req.headers['x-meiao-webhook-secret'] || url.searchParams.get('secret') || '').trim();
  return supplied && supplied === expected;
};

const handleChatwootAiWebhookRequest = async (req, res, url, systemSettings = {}) => {
  if (!isValidChatwootAiWebhookSecret(req, url)) {
    json(res, 401, { message: 'Chatwoot AI webhook secret 不正确。' });
    return;
  }
  try {
    const body = await readBody(req);
    const result = await handleChatwootAiWebhook({
      payload: body || {},
      env: buildOpenAICompatibleRuntimeEnv(process.env, systemSettings),
    });
    json(res, 200, result);
  } catch (error) {
    json(res, 502, { message: error?.message || 'Chatwoot AI 自动回复失败' });
  }
};

const mergeOpenAICompatibleSettingsUpdate = (currentSettings = {}, bodySettings = undefined) => {
  const current = normalizeOpenAICompatibleSettings(currentSettings?.openaiCompatible || {});
  if (!bodySettings || typeof bodySettings !== 'object') return current;
  const next = normalizeOpenAICompatibleSettings({
    apiKey: bodySettings.apiKey === undefined || String(bodySettings.apiKey || '').trim() === ''
      ? current.apiKey
      : bodySettings.apiKey,
    baseUrl: bodySettings.baseUrl === undefined ? current.baseUrl : bodySettings.baseUrl,
    models: bodySettings.models === undefined ? current.models : bodySettings.models,
  });
  return next;
};

const mergeSystemAnnouncementUpdate = (currentSettings = {}, bodyAnnouncement = undefined, admin = null) => {
  const current = normalizeSystemAnnouncement(currentSettings?.announcement || {});
  if (bodyAnnouncement === undefined) return current;
  if (!bodyAnnouncement || typeof bodyAnnouncement !== 'object' || bodyAnnouncement.enabled === false) {
    return createEmptySystemAnnouncement();
  }
  const title = String(bodyAnnouncement.title ?? current.title).trim();
  const content = String(bodyAnnouncement.content ?? current.content).trim();
  if (!title || !content) return createEmptySystemAnnouncement();
  const nextSeed = {
    id: bodyAnnouncement.id || current.id || `ann-${createEntityId()}`,
    title,
    content,
    enabled: true,
    updatedAt: Date.now(),
    updatedBy: admin?.displayName || admin?.username || '',
  };
  return normalizeSystemAnnouncement(nextSeed);
};

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value ?? createDefaultState()));

const isRemoteAssetUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const normalizeAssetRegistry = (value) => {
  if (!Array.isArray(value)) return [];

  const now = Date.now();
  const uniqueMap = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !isRemoteAssetUrl(item.url)) continue;
    const createdAt = Number(item.createdAt || 0);
    if (!createdAt || now - createdAt > ASSET_RETENTION_MS) continue;
    if (!uniqueMap.has(item.url)) {
      uniqueMap.set(item.url, { url: item.url, createdAt });
    }
  }

  return Array.from(uniqueMap.values());
};

const collectTrackedAssetUrls = (value, fieldName, bucket) => {
  if (Array.isArray(value)) {
    if (fieldName && TRACKED_URL_ARRAY_FIELDS.has(fieldName)) {
      value.forEach((item) => {
        if (isRemoteAssetUrl(item)) {
          bucket.add(item);
        }
      });
      return;
    }

    value.forEach((item) => collectTrackedAssetUrls(item, undefined, bucket));
    return;
  }

  if (!value || typeof value !== 'object') return;

  Object.entries(value).forEach(([key, child]) => {
    if (TRACKED_URL_FIELDS.has(key) && isRemoteAssetUrl(child)) {
      bucket.add(child);
      return;
    }

    collectTrackedAssetUrls(child, key, bucket);
  });
};

const clearExpiredAssetsFromState = (value, registryMap, fieldName) => {
  if (Array.isArray(value)) {
    if (fieldName && TRACKED_URL_ARRAY_FIELDS.has(fieldName)) {
      return value.map((item) => {
        if (!isRemoteAssetUrl(item)) return item;
        return registryMap.has(item) ? item : '';
      });
    }

    return value.map((item) => clearExpiredAssetsFromState(item, registryMap, undefined));
  }

  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (TRACKED_URL_FIELDS.has(key) && isRemoteAssetUrl(child) && !registryMap.has(child)) {
      next[key] = NULLABLE_TRACKED_FIELDS.has(key) ? null : undefined;
      continue;
    }

    next[key] = clearExpiredAssetsFromState(child, registryMap, key);
  }

  return next;
};

const APP_STATE_MAX_BYTES = (() => {
  const raw = Number(process.env.APP_STATE_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 4 * 1024 * 1024; // 4 MiB,远低于 MySQL max_allowed_packet 默认 16 MiB
})();

const prepareStateForStorage = (state) => {
  const rawState = compactAppStateForStorage(cloneJsonValue(state || createDefaultState()));
  const sizeBefore = JSON.stringify(rawState).length;
  const trimmedState = sizeBefore > APP_STATE_MAX_BYTES
    ? trimAppStateForStorage(rawState, APP_STATE_MAX_BYTES)
    : rawState;
  if (trimmedState !== rawState) {
    const sizeAfter = JSON.stringify(trimmedState).length;
    console.warn(
      `[app_states] trim triggered: ${sizeBefore} -> ${sizeAfter} bytes (max ${APP_STATE_MAX_BYTES})`,
    );
  }
  const existingRegistry = normalizeAssetRegistry(trimmedState[INTERNAL_ASSET_REGISTRY_KEY]);
  delete trimmedState[INTERNAL_ASSET_REGISTRY_KEY];

  const urlBucket = new Set();
  collectTrackedAssetUrls(trimmedState, undefined, urlBucket);

  const existingMap = new Map(existingRegistry.map((item) => [item.url, item.createdAt]));
  const nextRegistry = Array.from(urlBucket).map((url) => ({
    url,
    createdAt: existingMap.get(url) || Date.now(),
  }));

  const validRegistry = normalizeAssetRegistry(nextRegistry);
  const registryMap = new Map(validRegistry.map((item) => [item.url, item.createdAt]));
  const prunedState = clearExpiredAssetsFromState(trimmedState, registryMap, undefined);
  prunedState[INTERNAL_ASSET_REGISTRY_KEY] = validRegistry;
  return prunedState;
};

const prepareStateForClient = (state) => {
  const storedState = prepareStateForStorage(state);
  const clonedState = cloneJsonValue(storedState);
  delete clonedState[INTERNAL_ASSET_REGISTRY_KEY];
  return clonedState;
};

const createPasswordRecord = (password) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
};

const verifyPassword = (password, passwordHash, salt) => {
  const computed = scryptSync(password, salt, 64);
  const saved = Buffer.from(passwordHash, 'hex');
  return computed.length === saved.length && timingSafeEqual(computed, saved);
};

const normalizeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeCreditLimitMode = (value) => (
  value === CREDIT_LIMIT_MODES.LIMITED ? CREDIT_LIMIT_MODES.LIMITED : CREDIT_LIMIT_MODES.UNLIMITED
);

const normalizeCreditBalanceInput = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
};

const normalizeFeaturePermissions = (value = DEFAULT_FEATURE_PERMISSIONS) => {
  let permissions = value;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions);
    } catch {
      permissions = {};
    }
  }
  if (!permissions || typeof permissions !== 'object') permissions = {};
  return {
    videoGeneration: Boolean(permissions.videoGeneration),
  };
};

const serializeFeaturePermissions = (value) => JSON.stringify(normalizeFeaturePermissions(value));

const normalizeUserAnalysisModel = (value = '') => {
  const modelId = String(value || '').trim();
  if (!modelId) return '';
  return getChatModelCatalog().some((item) => item.id === modelId) ? modelId : '';
};

const canUseVideoGenerationFeature = (user) =>
  user?.role === 'admin' || normalizeFeaturePermissions(user?.featurePermissions).videoGeneration;

const resolveAuthorizedJobSubmissionPolicy = (
  user,
  body,
  {
    submissionOperation = 'create',
    voiceoverSourceProbe = {},
  } = {},
) => {
  const subtitleRemovalConfig = getSubtitleRemovalConfig(process.env);
  const voiceoverConfig = getVoiceoverConfig(process.env);
  return resolveJobSubmissionPolicy({
    module: body?.module,
    taskType: body?.taskType,
    provider: body?.provider,
    payload: body?.payload,
    subFeature: body?.subFeature,
    taskPurpose: body?.taskPurpose,
    hasVideoPermission: canUseVideoGenerationFeature(user),
    userRole: user?.role,
    productRestoreRollout: process.env.MEIAO_PRODUCT_RESTORE_ROLLOUT,
    submissionOperation,
    subtitleRemovalEnabled: subtitleRemovalConfig.enabled,
    subtitleRemovalConfigured: subtitleRemovalConfig.configured,
    subtitleRemovalBatchMaxItems: subtitleRemovalConfig.batchMaxItems,
    voiceoverEnabled: voiceoverConfig.enabled,
    voiceoverKieConfigured: Boolean(
      String(process.env.KIE_API_KEY || process.env.MEIAO_KIE_API_KEY || '').trim(),
    ),
    voiceoverReadiness: voiceoverTranslationReadiness,
    voiceoverSourceProbe,
  });
};

const normalizeJobMaxRetries = (taskType, value) => (
  VIDEO_JOB_TASK_TYPES.has(String(taskType || '')) ? 0 : value
);

const respondJobSubmissionPolicyError = (res, error) => {
  json(res, Number(error?.statusCode || 400), {
    message: error?.message || '任务提交策略校验失败。',
    code: error?.code || 'job_submission_policy_invalid',
  });
};

const normalizeStoredUser = (user) => ({
  ...normalizeCreditAccount(user),
  displayName: String(user?.displayName || user?.username || ''),
  avatarUrl: user?.avatarUrl ? String(user.avatarUrl) : '',
  avatarPreset: user?.avatarPreset ? String(user.avatarPreset) : 'aurora',
  jobConcurrency: normalizeJobConcurrency(user?.jobConcurrency, DEFAULT_JOB_CONCURRENCY),
  featurePermissions: normalizeFeaturePermissions(user?.featurePermissions),
  analysisModel: normalizeUserAnalysisModel(user?.analysisModel),
});

const createUser = ({ username, password, role = 'staff', displayName = '', jobConcurrency = DEFAULT_JOB_CONCURRENCY, featurePermissions = DEFAULT_FEATURE_PERMISSIONS, creditLimitMode = CREDIT_LIMIT_MODES.UNLIMITED, creditBalance = 0 }) => {
  const passwordRecord = createPasswordRecord(password);
  return {
    id: randomBytes(12).toString('hex'),
    username,
    displayName: displayName || username,
    avatarUrl: '',
    avatarPreset: 'aurora',
    role,
    status: 'active',
    passwordHash: passwordRecord.hash,
    salt: passwordRecord.salt,
    createdAt: Date.now(),
    lastLoginAt: null,
    jobConcurrency: normalizeJobConcurrency(jobConcurrency, DEFAULT_JOB_CONCURRENCY),
    featurePermissions: normalizeFeaturePermissions(featurePermissions),
    analysisModel: '',
    creditLimitMode: normalizeCreditLimitMode(creditLimitMode),
    creditBalance: normalizeCreditBalanceInput(creditBalance),
    creditReserved: 0,
    creditConsumed: 0,
  };
};

const createLogEntry = ({ user, level = 'info', module = 'system', action = 'unknown', message = '', detail = '', status = 'started', meta = null }) => ({
  id: randomBytes(12).toString('hex'),
  createdAt: Date.now(),
  level,
  module,
  action,
  message,
  detail,
  status,
  userId: user.id,
  username: user.username,
  displayName: user.displayName || user.username,
  meta: meta && typeof meta === 'object' ? meta : null,
});

const buildAgentRuntimeLogMeta = ({ agent, version, result = null, requestMode = '', sessionId = null, clientRequestId = '', error = null }) => ({
  agentId: agent?.id || '',
  agentName: agent?.name || '',
  versionId: version?.id || '',
  versionName: version?.versionName || '',
  sessionId: result?.sessionId || sessionId || null,
  clientRequestId: result?.clientRequestId || clientRequestId || null,
  requestType: result?.requestType || requestMode || (result?.sessionId ? 'chat' : 'validation'),
  selectedModel: result?.selectedModel || (requestMode === 'image_generation' ? version?.modelPolicy?.multimodalModel : version?.modelPolicy?.defaultModel) || '',
  totalTokens: Number(result?.totalTokens || 0),
  estimatedCost: Number(result?.estimatedCost || 0),
  latencyMs: Number(result?.latencyMs || 0),
  usedRetrieval: Boolean(result?.usedRetrieval),
  retrievalSummary: result?.retrievalSummary || [],
  imagePlan: result?.imagePlan || null,
  imageResultCount: Array.isArray(result?.imageResultUrls) ? result.imageResultUrls.length : 0,
  imageResultUrls: result?.imageResultUrls || [],
  creditsConsumed: result?.creditsConsumed,
  providerTaskId: result?.providerTaskId || error?.providerTaskId || '',
  providerStage: result?.providerStage || error?.providerStage || '',
  providerStatus: result?.providerStatus || error?.providerStatus || '',
  providerMessage: result?.providerMessage || error?.providerMessage || '',
  inputImageCount: Number(result?.imagePlan?.inputImageUrls?.length || error?.inputImageCount || 0),
  inputImageUrls: result?.imagePlan?.inputImageUrls || error?.inputImageUrls || [],
  usedImageReferenceUrls: result?.imagePlan?.imageReferences?.map?.((item) => item?.url).filter(Boolean) || error?.usedImageReferenceUrls || [],
  errorCode: result?.errorCode || error?.code || '',
  errorMessage: error?.message || '',
});

const getLogRetentionCutoff = () => Date.now() - LOG_RETENTION_MS;

const AGENT_VISIBILITY_SCOPE = 'internal';
const AGENT_SUMMARY_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const stringifyJsonField = (value, fallback = {}) => JSON.stringify(value && typeof value === 'object' ? value : fallback);

const createEntityId = () => randomBytes(12).toString('hex');

const getSuperAdminUsernames = () => {
  const usernames = new Set([
    process.env.MEIAO_ADMIN_USERNAME || 'admin',
    '将离',
  ]);
  String(process.env.MEIAO_SUPER_ADMIN_USERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => usernames.add(item));
  return usernames;
};

const isSuperAdminUser = (user) => Boolean(user?.role === 'admin' && user?.username && getSuperAdminUsernames().has(user.username));

const cleanKnowledgeBaseIds = (value) => Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));
const cleanDocumentIds = (value) => Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));
const normalizeVersionKnowledgeDocumentBindings = (value, knowledgeBaseIds = []) => {
  const allowedKnowledgeBaseIds = new Set(cleanKnowledgeBaseIds(knowledgeBaseIds));
  return Array.isArray(value)
    ? value
        .map((item) => ({
          knowledgeBaseId: typeof item?.knowledgeBaseId === 'string' ? item.knowledgeBaseId.trim() : '',
          enabledDocumentIds: cleanDocumentIds(item?.enabledDocumentIds),
        }))
        .filter((item) => item.knowledgeBaseId && (!allowedKnowledgeBaseIds.size || allowedKnowledgeBaseIds.has(item.knowledgeBaseId)))
    : [];
};
const resolveEnabledKnowledgeDocumentIds = (version, knowledgeBaseId, availableDocumentIds = []) => {
  const normalizedBindings = normalizeVersionKnowledgeDocumentBindings(
    version?.knowledgeDocumentBindings,
    version?.knowledgeBaseIds || []
  );
  const binding = normalizedBindings.find((item) => item.knowledgeBaseId === knowledgeBaseId);
  if (!binding) return new Set(availableDocumentIds);
  const availableSet = new Set(cleanDocumentIds(availableDocumentIds));
  return new Set(binding.enabledDocumentIds.filter((documentId) => availableSet.has(documentId)));
};

const normalizeAgentStatus = (value) => (['draft', 'published', 'archived'].includes(value) ? value : 'draft');
const normalizeKnowledgeBaseStatus = (value) => (['active', 'archived'].includes(value) ? value : 'active');
const normalizeValidationStatus = (value) => (['pending', 'success', 'failed'].includes(value) ? value : 'pending');
const normalizeSourceType = (value) => (value === 'manual' ? 'manual' : 'upload');
const normalizeKnowledgeNormalizedStatus = (value) => (['idle', 'processing', 'success', 'failed'].includes(value) ? value : 'idle');
const normalizeKnowledgeChunkSource = (value) => (value === 'normalized' ? 'normalized' : 'raw');
const normalizeKnowledgeChunkStrategyValue = (value) => normalizeKnowledgeChunkStrategy(value);
const normalizeVersionName = (value, versionNo, timestamp = Date.now()) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const fallbackName = createDefaultVersionName(versionNo, timestamp);
  if (!trimmed) return fallbackName.slice(0, 160);
  if (trimmed === 'V1' && Number(versionNo || 1) !== 1) return fallbackName.slice(0, 160);
  return trimmed.slice(0, 160);
};
const getChatModelCatalog = (publicBaseUrl = '') =>
  buildPublicSystemConfig(process.env, {}, publicBaseUrl ? { publicBaseUrl } : {}).agentModels.chat || [];
const getImageModelCatalog = () => buildPublicSystemConfig(process.env).agentModels.image || [];
const getChatModelCapability = (modelId, publicBaseUrl = '') => getChatModelCatalog(publicBaseUrl).find((item) => item.id === modelId) || null;

const getAttachmentCapabilityError = ({ capability, attachments = [], requestMode = 'chat', modelLabel = '当前模型' }) => {
  if (requestMode !== 'image_generation' && attachments.some((item) => item?.kind === 'image') && !capability?.supportsImageInput) {
    return `${modelLabel}当前环境下不支持图片输入`;
  }
  if (requestMode !== 'image_generation' && attachments.some((item) => item?.kind !== 'image') && !capability?.supportsFileInput) {
    return `${modelLabel}当前环境下不支持文件输入`;
  }
  return '';
};
const getImageModelCapability = (modelId) => getImageModelCatalog().find((item) => item.id === modelId) || null;
const resolveDefaultAnalysisChatModel = (...preferredModels) => {
  const available = getChatModelCatalog().map((item) => item.id);
  for (const item of preferredModels) {
    const modelId = String(item || '').trim();
    if (modelId && available.includes(modelId)) return modelId;
  }
  return available[0] || '';
};
// Task I3 第一批迁移:四个历史模型 env 的读取统一走 modelDispatch 的 env 兼容层,
// 候选优先序与迁移前逐项一致(agent→planning→default-analysis→default-chat→kie-chat),
// 输入矩阵探针已验证新旧输出全等(MEIAO_DEFAULT_ANALYSIS_MODEL 不在四个 env 之列,保持直读)。
const resolveConfiguredAnalysisModel = (systemSettings = {}, ...preferredModels) =>
  resolveDefaultAnalysisChatModel(
    systemSettings?.analysisModel,
    resolveModelForNeed({ need: 'analysis', analysisKind: 'agent', env: process.env }).model,
    resolveModelForNeed({ need: 'analysis', analysisKind: 'planning', env: process.env }).model,
    process.env?.MEIAO_DEFAULT_ANALYSIS_MODEL,
    resolveModelForNeed({ need: 'chat', env: process.env }).model,
    resolveModelForNeed({ need: 'kie-chat', env: process.env }).model,
    ...preferredModels
  );
const resolveConfiguredVideoAnalysisModel = (systemSettings = {}, ...preferredModels) =>
  resolveDefaultAnalysisChatModel(
    systemSettings?.videoAnalysisModel,
    process.env?.MEIAO_VIDEO_ANALYSIS_MODEL,
    'gemini-3-flash-openai',
    ...preferredModels
  );
const sanitizeAllowedChatModels = (configured, fallbacks = []) => {
  const catalog = getChatModelCatalog();
  const available = new Set(catalog.map((item) => item.id));
  const preferred = [...(Array.isArray(configured) ? configured : []), ...fallbacks]
    .map((item) => String(item || '').trim())
    .filter((item) => item && available.has(item));
  const unique = Array.from(new Set(preferred));
  if (unique.length > 0) return unique;
  const configuredRelayModels = catalog
    .filter((item) => item.provider === 'openai_compatible')
    .map((item) => item.id);
  const recoveryModels = [...configuredRelayModels, ...DEFAULT_RECOVERY_ALLOWED_CHAT_MODELS]
    .filter((item) => available.has(item));
  if (recoveryModels.length > 0) return recoveryModels;
  return catalog[0]?.id ? [catalog[0].id] : [];
};
const DEFAULT_RECOVERY_ALLOWED_CHAT_MODELS = ['gpt-5-4-openai-resp', 'gemini-3-flash-openai'];
const LEGACY_DEFAULT_ALLOWED_CHAT_MODELS = new Set(['gpt-5-4-openai-resp', 'gemini-3-flash-openai']);
const EXPANDED_LEGACY_CHAT_MODELS = ['claude-sonnet-4-6'];
const expandLegacyAllowedChatModels = (allowedModels = []) => {
  const unique = Array.from(new Set((Array.isArray(allowedModels) ? allowedModels : []).map((item) => String(item || '').trim()).filter(Boolean)));
  const isLegacyDefaultAllowed = unique.length === LEGACY_DEFAULT_ALLOWED_CHAT_MODELS.size
    && Array.from(LEGACY_DEFAULT_ALLOWED_CHAT_MODELS).every((id) => unique.includes(id));
  if (!isLegacyDefaultAllowed) return unique;
  const available = new Set(getChatModelCatalog().map((item) => item.id));
  return Array.from(new Set([...unique, ...EXPANDED_LEGACY_CHAT_MODELS.filter((id) => available.has(id))]));
};
const resolveImageModel = (requestedModel = '') => {
  const available = getImageModelCatalog().map((item) => item.id);
  const preferred = String(requestedModel || '').trim();
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] || 'gpt-image-2';
};
const sanitizeModelPolicy = (modelPolicy = {}, allowedChatModels = []) => {
  const safeAllowedChatModels = sanitizeAllowedChatModels(allowedChatModels, [
    modelPolicy?.defaultModel,
    modelPolicy?.cheapModel,
    modelPolicy?.advancedModel,
  ]);
  const defaultModel = safeAllowedChatModels.includes(String(modelPolicy?.defaultModel || '').trim())
    ? String(modelPolicy.defaultModel).trim()
    : safeAllowedChatModels[0] || '';
  const cheapModel = safeAllowedChatModels.includes(String(modelPolicy?.cheapModel || '').trim())
    ? String(modelPolicy.cheapModel).trim()
    : defaultModel;
  const advancedModel = safeAllowedChatModels.includes(String(modelPolicy?.advancedModel || '').trim())
    ? String(modelPolicy.advancedModel).trim()
    : defaultModel;

  return {
    ...modelPolicy,
    defaultModel,
    cheapModel,
    advancedModel,
    multimodalModel: resolveImageModel(modelPolicy?.multimodalModel),
    imageGenerationEnabled: Boolean(modelPolicy?.imageGenerationEnabled),
  };
};
const resolveAllowedChatModels = (version) => {
  const configured = Array.isArray(version?.allowedChatModels) && version.allowedChatModels.length > 0
    ? version.allowedChatModels
    : [version?.defaultChatModel || version?.modelPolicy?.defaultModel || version?.modelPolicy?.cheapModel].filter(Boolean);
  return expandLegacyAllowedChatModels(sanitizeAllowedChatModels(configured, [version?.defaultChatModel, version?.modelPolicy?.defaultModel, version?.modelPolicy?.cheapModel]));
};
const resolveChatSessionModel = (version, requestedModel = '') => {
  const allowedModels = resolveAllowedChatModels(version);
  const preferred = String(requestedModel || version?.defaultChatModel || version?.modelPolicy?.defaultModel || version?.modelPolicy?.cheapModel || '').trim();
  if (preferred && allowedModels.includes(preferred)) return preferred;
  return allowedModels[0] || preferred;
};
const resolveChatFallbackModels = (version, primaryModel = '') => {
  const allowedModels = resolveAllowedChatModels(version);
  const blocked = new Set([String(primaryModel || '').trim()].filter(Boolean));
  const preferred = [
    version?.modelPolicy?.cheapModel,
    version?.modelPolicy?.advancedModel,
    ...allowedModels,
  ]
    .map((item) => String(item || '').trim())
    .filter((item) => item && !blocked.has(item) && allowedModels.includes(item));
  return Array.from(new Set(preferred));
};
const resolveImageAnalysisFallbackModels = (version, primaryModel = '') => {
  const available = new Set(getChatModelCatalog().map((item) => item.id));
  const allowedModels = resolveAllowedChatModels(version);
  const blocked = new Set([String(primaryModel || '').trim()].filter(Boolean));
  const preferred = [
    version?.modelPolicy?.defaultModel,
    version?.modelPolicy?.cheapModel,
    version?.modelPolicy?.advancedModel,
    'gpt-5.4',
    'gpt-5-4-openai-resp',
    'claude-sonnet-4-6',
    ...allowedModels,
  ]
    .map((item) => String(item || '').trim())
    .filter((item) => item && !blocked.has(item) && available.has(item));
  return Array.from(new Set(preferred));
};
const canManageOwnedResource = (user, ownerUserId) => Boolean(user?.role === 'admin' && (isSuperAdminUser(user) || ownerUserId === user.id));

const shouldUseKnowledgeRetrieval = (message, retrievalPolicy, knowledgeBaseIds) => {
  if (!retrievalPolicy?.enabled) return false;
  if (!Array.isArray(knowledgeBaseIds) || knowledgeBaseIds.length === 0) return false;
  const text = String(message || '').trim();
  if (!text) return false;
  if (text.length >= 12) return true;
  return /(怎么|如何|流程|步骤|规则|要求|SOP|知识库|是否|能否|说明|退款|售后|权限|配置|设置|为什么)/i.test(text);
};

const buildKnowledgeNormalizationPrompt = (rawText) => ([
  'R Role 角色',
  '你是一名知识库整理助手。',
  '',
  'T Task 任务',
  '把用户提供的规则、SOP 或规范性文档整理成更适合检索的结构化文本。',
  '',
  'C Constraint 约束',
  '1. 必须保留原意，不得凭空新增规则，不得删掉关键限制。',
  '2. 优先整理成短标题 + 规则说明 + 条目列表，让每条规则尽量独立完整。',
  '3. 如果原文本身已经结构清晰，只做轻量整理，不要过度改写。',
  '4. 只输出整理后的正文，不要解释，不要加代码块，不要加前言。',
  '',
  'F Format 格式',
  '直接输出整理后的正文。',
  '',
  'E Example 示例',
  '标题',
  '- 规则1：说明',
  '- 规则2：说明',
  '',
  '待整理原文：',
  String(rawText || '').trim(),
].join('\n'));

const normalizeKnowledgeDocumentText = async (rawText, processEnv, systemSettings = {}) => {
  const source = String(rawText || '').trim();
  if (!source) {
    return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '原文为空，无法整理。' };
  }
  try {
    const normalizationModel = resolveConfiguredAnalysisModel(systemSettings);
    if (!normalizationModel) {
      return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '当前没有可用的分析模型。' };
    }
    const messages = [
      { role: 'system', content: '你负责把知识库原文整理为更适合检索的规则化文本。' },
      { role: 'user', content: buildKnowledgeNormalizationPrompt(source) },
    ];
    const output = await executeProviderJobWithManagedAssetScrub(
      {
        taskType: 'kie_chat',
        payload: {
          messages,
          model: normalizationModel,
        },
      },
      processEnv,
      new AbortController().signal
    );
    const normalizedText = String(output?.result?.content || '').trim();
    if (!normalizedText) {
      return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '分析模型未返回可用整理结果。' };
    }
    return {
      normalizedText,
      normalizedStatus: 'success',
      chunkSource: 'normalized',
      normalizationError: '',
    };
  } catch (error) {
    return {
      normalizedText: '',
      normalizedStatus: 'failed',
      chunkSource: 'raw',
      normalizationError: String(error?.message || 'AI 规范整理失败。'),
    };
  }
};

const embedChunkContentsSafe = async (contents) => {
  const source = Array.isArray(contents) ? contents : [];
  if (source.length === 0) return [];
  try {
    return await embedTexts(source, process.env);
  } catch (error) {
    console.warn('[rag] chunk embedding 失败，降级写入 null', {
      message: error?.message || String(error || ''),
    });
    return source.map(() => null);
  }
};

const normalizeAgentVersionRecord = (row, knowledgeBaseIds = []) => {
  const rawConfig = normalizeAgentConfig({
    systemPrompt: row.system_prompt,
    knowledgeDocumentBindings: parseJsonField(row.knowledge_document_bindings_json, []),
    replyStyleRules: parseJsonField(row.reply_style_rules_json, {}),
    modelPolicy: parseJsonField(row.model_policy_json, {}),
    contextPolicy: parseJsonField(row.context_policy_json, {}),
    retrievalPolicy: parseJsonField(row.retrieval_policy_json, {}),
    toolPolicy: parseJsonField(row.tool_policy_json, {}),
  });
  const allowedChatModels = sanitizeAllowedChatModels(parseJsonField(row.allowed_chat_models_json, []), [
    row.default_chat_model,
    rawConfig.modelPolicy.defaultModel,
    rawConfig.modelPolicy.cheapModel,
  ]);
  const modelPolicy = sanitizeModelPolicy(rawConfig.modelPolicy, allowedChatModels);
  const config = {
    ...rawConfig,
    modelPolicy,
  };
  const defaultChatModel = allowedChatModels.includes(String(row.default_chat_model || '').trim())
    ? String(row.default_chat_model).trim()
    : modelPolicy.defaultModel;
  return {
    id: row.id,
    agentId: row.agent_id,
    versionNo: Number(row.version_no || 1),
    versionName: normalizeVersionName(row.version_name, row.version_no, row.created_at),
    allowedChatModels,
    defaultChatModel,
    isPublished: Boolean(row.is_published),
    systemPrompt: config.systemPrompt,
    replyStyleRules: config.replyStyleRules,
    modelPolicy: config.modelPolicy,
    contextPolicy: config.contextPolicy,
    retrievalPolicy: config.retrievalPolicy,
    toolPolicy: config.toolPolicy,
    validationStatus: normalizeValidationStatus(row.validation_status),
    validationSummary: parseJsonField(row.validation_summary_json, null),
    createdBy: row.created_by,
    createdAt: Number(row.created_at || Date.now()),
    knowledgeBaseIds: cleanKnowledgeBaseIds(knowledgeBaseIds),
    knowledgeDocumentBindings: normalizeVersionKnowledgeDocumentBindings(rawConfig.knowledgeDocumentBindings, knowledgeBaseIds),
  };
};

const buildAgentVersionInsertRecord = ({ agentId, versionNo, createdBy, source = null }) => {
  const createdAt = Date.now();
  const rawConfig = normalizeAgentConfig({
    systemPrompt: source?.systemPrompt || '',
    knowledgeDocumentBindings: source?.knowledgeDocumentBindings || [],
    replyStyleRules: source?.replyStyleRules || {},
    modelPolicy: source?.modelPolicy || {},
    contextPolicy: source?.contextPolicy || {},
    retrievalPolicy: source?.retrievalPolicy || {},
    toolPolicy: source?.toolPolicy || {},
  });
  const allowedChatModels = sanitizeAllowedChatModels(source?.allowedChatModels, [
    source?.defaultChatModel,
    rawConfig.modelPolicy.defaultModel,
    rawConfig.modelPolicy.cheapModel,
  ]);
  const config = {
    ...rawConfig,
    modelPolicy: sanitizeModelPolicy(rawConfig.modelPolicy, allowedChatModels),
  };
  return {
    id: createEntityId(),
    agentId,
    versionNo,
    versionName: normalizeVersionName(source?.versionName, versionNo, createdAt),
    allowedChatModels,
    defaultChatModel: allowedChatModels.includes(String(source?.defaultChatModel || '').trim())
      ? String(source.defaultChatModel).trim()
      : config.modelPolicy.defaultModel || '',
    isPublished: 0,
    systemPrompt: config.systemPrompt,
    knowledgeDocumentBindingsJson: stringifyJsonField(
      normalizeVersionKnowledgeDocumentBindings(config.knowledgeDocumentBindings, source?.knowledgeBaseIds || []),
      []
    ),
    replyStyleRulesJson: stringifyJsonField(config.replyStyleRules),
    modelPolicyJson: stringifyJsonField(config.modelPolicy),
    contextPolicyJson: stringifyJsonField(config.contextPolicy),
    retrievalPolicyJson: stringifyJsonField(config.retrievalPolicy),
    toolPolicyJson: stringifyJsonField(config.toolPolicy),
    validationStatus: 'pending',
    validationSummaryJson: null,
    createdBy,
    createdAt,
    knowledgeBaseIds: cleanKnowledgeBaseIds(source?.knowledgeBaseIds || []),
  };
};

const pruneLogsByRetention = (logs) => {
  const cutoff = getLogRetentionCutoff();
  if (!Array.isArray(logs)) return [];
  return logs.filter((item) => item && typeof item === 'object' && item.id && Number(item.createdAt) >= cutoff);
};

const normalizeLogs = (logs) => {
  return pruneLogsByRetention(logs)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
};

const normalizeLogFilterValue = (value) => {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'all' ? normalized : '';
};

const normalizeLogFilterTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const matchesLogFilters = (log, filters = {}) => {
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const startAt = normalizeLogFilterTimestamp(filters.startAt);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter && log.module !== moduleFilter) return false;
  if (userFilter && log.userId !== userFilter) return false;
  if (statusFilter && log.status !== statusFilter) return false;
  if (startAt && Number(log.createdAt || 0) < startAt) return false;
  if (endAt && Number(log.createdAt || 0) > endAt) return false;
  return true;
};

const ensureLocalStore = () => {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    const admin = createUser({
      username: process.env.MEIAO_ADMIN_USERNAME || 'admin',
      password: process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });
    const initialStore = {
      users: [admin],
      sessions: [],
      logs: [],
      jobs: [],
      systemSettings: createDefaultSystemSettings(),
      agents: [],
      agentVersions: [],
      agentVersionKnowledgeBases: [],
      knowledgeBases: [],
      knowledgeDocuments: [],
      knowledgeChunks: [],
      chatSessions: [],
      chatMessages: [],
      agentUsageLogs: [],
      virtualModels: [],
      virtualModelVersions: [],
      virtualModelAssets: [],
      appStates: {
        [admin.id]: createDefaultState(),
      },
    };
    writeFileSync(storePath, JSON.stringify(initialStore, null, 2), 'utf8');
  }
};

const normalizeLocalStoreShape = (store, options = {}) => {
  store.users = Array.isArray(store.users) ? store.users.map(normalizeStoredUser) : [];
  store.logs = normalizeLogs(store.logs);
  store.jobs = options.reconcileRunningJobs
    ? reconcileRestartedLocalJobs(Array.isArray(store.jobs) ? store.jobs : [])
    : normalizeLocalJobs(Array.isArray(store.jobs) ? store.jobs : []);
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  store.systemSettings = normalizeSystemSettings(store.systemSettings || createDefaultSystemSettings());
  store.appStates = store.appStates && typeof store.appStates === 'object' ? store.appStates : {};
  store.usageDaily = Array.isArray(store.usageDaily) ? store.usageDaily : [];
  store.agents = Array.isArray(store.agents) ? store.agents : [];
  store.agentVersions = Array.isArray(store.agentVersions) ? store.agentVersions : [];
  store.agentVersionKnowledgeBases = Array.isArray(store.agentVersionKnowledgeBases) ? store.agentVersionKnowledgeBases : [];
  store.knowledgeBases = Array.isArray(store.knowledgeBases) ? store.knowledgeBases : [];
  store.knowledgeDocuments = Array.isArray(store.knowledgeDocuments) ? store.knowledgeDocuments : [];
  store.knowledgeChunks = Array.isArray(store.knowledgeChunks) ? store.knowledgeChunks : [];
  store.chatSessions = Array.isArray(store.chatSessions) ? store.chatSessions.map((item) => ({
    ...item,
    selectedModel: String(item?.selectedModel || ''),
    reasoningLevel: item?.reasoningLevel ? String(item.reasoningLevel) : null,
    webSearchEnabled: Boolean(item?.webSearchEnabled),
  })) : [];
  store.chatMessages = Array.isArray(store.chatMessages) ? store.chatMessages : [];
  store.agentUsageLogs = Array.isArray(store.agentUsageLogs) ? store.agentUsageLogs : [];
  store = normalizeVirtualModelLocalStore(store);
  store.agentVersions = store.agentVersions.map((item) => {
    const allowedChatModels = sanitizeAllowedChatModels(item?.allowedChatModels, [
      item?.defaultChatModel,
      item?.modelPolicy?.defaultModel,
      item?.modelPolicy?.cheapModel,
    ]);
    const modelPolicy = sanitizeModelPolicy(item?.modelPolicy || {}, allowedChatModels);
    const knowledgeBaseIds = listLocalVersionKnowledgeBaseIds(store, item?.id);
    const defaultChatModel = allowedChatModels.includes(String(item?.defaultChatModel || '').trim())
      ? String(item.defaultChatModel).trim()
      : modelPolicy.defaultModel;
    return {
      ...item,
      allowedChatModels,
      defaultChatModel,
      modelPolicy,
      knowledgeDocumentBindings: normalizeVersionKnowledgeDocumentBindings(item?.knowledgeDocumentBindings, knowledgeBaseIds),
    };
  });
  store.chatSessions = store.chatSessions.map((item) => {
    const version = (store.agentVersions || []).find((versionItem) => versionItem.id === item.agentVersionId);
    const selectedModel = resolveChatSessionModel(version, item.selectedModel);
    const capability = getChatModelCapability(selectedModel);
    return {
      ...item,
      selectedModel,
      reasoningLevel: capability?.supportsReasoningLevel && item?.reasoningLevel ? String(item.reasoningLevel) : null,
      webSearchEnabled: capability?.supportsWebSearch ? Boolean(item?.webSearchEnabled) : false,
    };
  });
  return store;
};

const reconcileLocalStoreJobsAfterRestart = () => {
  ensureLocalStore();
  const rawStore = JSON.parse(readFileSync(storePath, 'utf8'));
  localStoreCache = normalizeLocalStoreShape(rawStore, { reconcileRunningJobs: true });
  writeFileSync(storePath, JSON.stringify(localStoreCache, null, 2), 'utf8');
  return localStoreCache.jobs.filter((job) => job.errorCode === 'service_restarted' && job.status === 'retry_waiting');
};

const readLocalStore = () => {
  ensureLocalStore();
  if (!localStoreCache) {
    localStoreCache = normalizeLocalStoreShape(JSON.parse(readFileSync(storePath, 'utf8')));
  }
  return localStoreCache;
};

const writeLocalStore = (store) => {
  const normalizedStore = normalizeLocalStoreShape(store || localStoreCache || {});
  localStoreCache = normalizedStore;
  writeFileSync(storePath, JSON.stringify(normalizedStore, null, 2), 'utf8');
};

const scrubLocalStatesForDeletedAssets = async () => {
  const store = readLocalStore();
  const assets = await listStoredAssets(null);
  Object.keys(store.appStates || {}).forEach((userId) => {
    const validAssetUrls = buildValidManagedAssetReferences(
      assets.filter((asset) => String(asset?.userId || '') === String(userId)),
    );
    store.appStates[userId] = prepareStateForStorage(
      scrubUnavailableManagedAssetStateReferences(store.appStates[userId] || createDefaultState(), validAssetUrls)
    );
  });
  writeLocalStore(store);
};

const buildLogActor = ({ id = 'system', username = 'system', displayName = '' } = {}) => ({
  id,
  username,
  displayName: displayName || username || 'system',
});

const getAllowedOrigins = () => normalizeAllowedOrigins(process.env.MEIAO_ALLOWED_ORIGINS);

const buildCorsHeaders = (req) => {
  const requestOrigin = req.headers.origin || '';
  const allowedOrigins = getAllowedOrigins();
  const allowAnyOrigin = allowedOrigins.length === 0;
  const allowOrigin = allowAnyOrigin
    ? requestOrigin || '*'
    : allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  };
};

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(res.__corsHeaders || {}),
  });
  res.end(JSON.stringify(payload));
};

const readBody = async (req, options = {}) => {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_JSON_BODY_BYTES;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const MULTIPART_FILE_PREFIX_MAX_BYTES = 1024 * 1024;

const readMultipartFormData = async (req, options = {}) => {
  const inspectManagedImage = options.inspectManagedImage === true;
  const multipartContentType = String(req.headers['content-type'] || '');
  let maxBytes = inspectManagedImage
    ? null
    : Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_MULTIPART_BODY_BYTES;
  const contentLength = Number.parseInt(String(req.headers['content-length'] || '0'), 10);
  if (maxBytes !== null && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('REQUEST_MULTIPART_BODY_TOO_LARGE');
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    chunks.push(chunk);
    if (maxBytes === null) {
      const prefix = Buffer.concat(chunks, totalBytes);
      const inspection = inspectManagedImageMultipartPrefix(prefix, { contentType: multipartContentType });
      if (inspection.complete) {
        maxBytes = inspection.isImage ? getManagedImageMultipartBodyMaxBytes() : MAX_MULTIPART_BODY_BYTES;
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error('REQUEST_MULTIPART_BODY_TOO_LARGE');
        }
      } else if (totalBytes > MULTIPART_FILE_PREFIX_MAX_BYTES) {
        throw new Error('REQUEST_MULTIPART_BODY_TOO_LARGE');
      }
    }
    if (maxBytes !== null && totalBytes > maxBytes) throw new Error('REQUEST_MULTIPART_BODY_TOO_LARGE');
  }
  const requestBody = Buffer.concat(chunks);
  if (maxBytes === null) {
    const inspection = inspectManagedImageMultipartPrefix(requestBody, { contentType: multipartContentType, final: true });
    maxBytes = inspection.isImage ? getManagedImageMultipartBodyMaxBytes() : MAX_MULTIPART_BODY_BYTES;
    if (requestBody.length > maxBytes) throw new Error('REQUEST_MULTIPART_BODY_TOO_LARGE');
  }
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('content-length', String(requestBody.length));

  const request = new Request('http://127.0.0.1/internal-upload', {
    method: req.method,
    headers: requestHeaders,
    body: requestBody,
  });
  return request.formData();
};

const getManagedImageJsonBodyMaxBytes = () => Math.ceil(getManagedImageMaxBytes(process.env) * 4 / 3) + 1024 * 1024;
const getManagedImageMultipartBodyMaxBytes = () => getManagedImageMaxBytes(process.env) + 2 * 1024 * 1024;

const isMediaTranscodeRoute = (url, method) => {
  if (!['POST', 'DELETE'].includes(String(method || '').toUpperCase())) return false;
  return url.pathname === '/api/media-transcodes/sessions'
    || /^\/api\/media-transcodes\/sessions\/[^/]+(?:\/convert)?$/.test(url.pathname);
};

const handleMediaTranscodeRequest = async ({ req, res, url, user }) => {
  if (!isMediaTranscodeRoute(url, req.method)) return false;
  if (!mediaTranscodeService.getStatus().enabled) {
    throw createMediaTranscodeError('media_transcode_disabled', '媒体裁剪转码功能当前未启用');
  }

  if (url.pathname === '/api/media-transcodes/sessions' && req.method === 'POST') {
    const contentLength = Number.parseInt(String(req.headers['content-length'] || '0'), 10);
    const multipartBodyMaxBytes = MEDIA_TRANSCODE_INPUT_MAX_BYTES + 2 * 1024 * 1024;
    if (Number.isFinite(contentLength) && contentLength > multipartBodyMaxBytes) {
      throw createMediaTranscodeError('media_input_too_large', '上传文件过大，无法进入转码流程');
    }
    console.info('[media-transcode]', {
      action: 'media_transcode_upload_started',
      createdAt: Date.now(),
      userId: user.id,
      contentLength: Number.isFinite(contentLength) ? contentLength : 0,
    });
    const formData = await readMultipartFormData(req, {
      maxBytes: multipartBodyMaxBytes,
    });
    const file = formData.get('file');
    const kind = String(formData.get('kind') || '').trim().toLowerCase();
    const profile = String(formData.get('profile') || 'seedance_reference').trim().toLowerCase();
    if (!(file instanceof File)) {
      throw createMediaTranscodeError('media_source_empty', '请选择需要处理的视频或音频文件');
    }
    if (file.size > MEDIA_TRANSCODE_INPUT_MAX_BYTES) {
      throw createMediaTranscodeError('media_input_too_large', '上传文件过大，无法进入转码流程');
    }
    const result = await mediaTranscodeApi.createSession({
      userId: user.id,
      kind,
      profile,
      fileName: file.name || 'source',
      fileBuffer: Buffer.from(await file.arrayBuffer()),
    });
    json(res, 201, result);
    return true;
  }

  const convertMatch = url.pathname.match(/^\/api\/media-transcodes\/sessions\/([^/]+)\/convert$/);
  if (convertMatch && req.method === 'POST') {
    const body = await readBody(req, { maxBytes: 64 * 1024 });
    const result = await mediaTranscodeApi.convertSession({
      userId: user.id,
      sessionId: decodeURIComponent(convertMatch[1]),
      startSeconds: body?.startSeconds,
      endSeconds: body?.endSeconds,
      module: String(body?.module || 'video').slice(0, 60),
    });
    json(res, 200, result);
    return true;
  }

  const sessionMatch = url.pathname.match(/^\/api\/media-transcodes\/sessions\/([^/]+)$/);
  if (sessionMatch && req.method === 'DELETE') {
    const result = await mediaTranscodeApi.cancelSession({
      userId: user.id,
      sessionId: decodeURIComponent(sessionMatch[1]),
    });
    json(res, 200, result);
    return true;
  }

  return false;
};

const normalizeSpiderGatewayUrl = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed.replace(/\/+$/u, '');
};

const getSpiderConfig = () => ({
  apiKey: String(process.env.MEIAO_SPIDER_API_KEY || process.env.SPIDER_API_KEY || '').trim(),
  gatewayUrl: normalizeSpiderGatewayUrl(process.env.MEIAO_SPIDER_GATEWAY_URL || process.env.SPIDER_GATEWAY_URL || ''),
});

const respondSpiderConfigMissing = (res, reason) => {
  if (reason === 'gateway') {
    json(res, 500, {
      message: 'Spider 网关地址未配置，请设置 MEIAO_SPIDER_GATEWAY_URL 或 SPIDER_GATEWAY_URL。',
      code: 'missing_spider_gateway',
    });
    return;
  }
  json(res, 500, {
    message: 'Spider API key 未配置，请设置 MEIAO_SPIDER_API_KEY 或 SPIDER_API_KEY。',
    code: 'missing_spider_api_key',
  });
};

const buildSpiderUrl = (gatewayUrl, resourcePath) => {
  const base = gatewayUrl.replace(/\/+$/u, '');
  const suffix = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  return `${base}${suffix}`;
};

const fetchSpiderJson = async ({ gatewayUrl, apiKey, path, payload }) => {
  const target = buildSpiderUrl(gatewayUrl, path);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload || {}),
  });

  const bodyText = await response.text();
  let responseData = {};
  if (bodyText) {
    try {
      responseData = JSON.parse(bodyText);
    } catch {
      responseData = { raw: bodyText };
    }
  }

  if (!response.ok) {
    throw new Error(`Spider 请求失败（${response.status}）${JSON.stringify(responseData)}`);
  }
  return responseData;
};

const fetchSpiderFormData = async ({ gatewayUrl, apiKey, path, fields }) => {
  const target = buildSpiderUrl(gatewayUrl, path);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
  }
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: form.toString(),
  });
  const bodyText = await response.text();
  let responseData = {};
  if (bodyText) {
    try { responseData = JSON.parse(bodyText); } catch { responseData = { raw: bodyText }; }
  }
  if (!response.ok) {
    throw new Error(`Spider 请求失败（${response.status}）${JSON.stringify(responseData)}`);
  }
  return responseData;
};

const createSpiderFetch = ({ gatewayUrl, apiKey }) => async ({ platform, source, videoId, url, uniqueId, secUid, musicId, analysisItems, noteId, userId, shareText }) => {
  const normalizedItems = Array.isArray(analysisItems) ? analysisItems.map((item) => String(item || '')) : [];

  let endpoint, payload;

  if (platform === 'tiktok') {
    switch (source) {
      case 'user_profile':
        endpoint = '/v1/spider/tiktok/user-profile';
        payload = { unique_id: uniqueId };
        break;
      case 'user_posts':
        endpoint = '/v1/spider/tiktok/user-posts';
        payload = { unique_id: uniqueId, count: 6 };
        break;
      case 'video_comments':
        endpoint = '/v1/spider/tiktok/video-comments';
        payload = { aweme_id: videoId, count: 20 };
        break;
      case 'music_detail':
        endpoint = '/v1/spider/tiktok/music-detail';
        payload = { music_id: musicId };
        break;
      default: // 'video'
        endpoint = '/v1/spider/tiktok/video-by-url-v2';
        payload = { share_url: url, aweme_id: videoId, analysis_items: normalizedItems };
    }
  } else if (platform === 'xhs') {
    // 小红书 — 全部用 formData
    switch (source) {
      case 'user_info':
        return fetchSpiderFormData({ gatewayUrl, apiKey, path: '/v1/spider/xhs/user-info', fields: { user_id: userId, xsec_token: shareText } });
      case 'user_posts':
        return fetchSpiderFormData({ gatewayUrl, apiKey, path: '/v1/spider/xhs/user-notes', fields: { user_id: userId, xsec_token: shareText, num: 6 } });
      case 'note_comments':
        return fetchSpiderFormData({ gatewayUrl, apiKey, path: '/v1/spider/xhs-web/fetch-note-comments', fields: { note_id: noteId } });
      default: // 'note'
        return fetchSpiderFormData({ gatewayUrl, apiKey, path: '/v1/spider/xhs-web/fetch-feed-notes-v3', fields: { short_url: url } });
    }
  } else {
    // douyin
    switch (source) {
      case 'user_info':
        endpoint = '/v1/spider/douyin/user-info';
        payload = { sec_uid: secUid };
        break;
      case 'video_list':
        endpoint = '/v1/spider/douyin/video-list';
        payload = { sec_uid: secUid, count: 6 };
        break;
      default: // 'video'
        endpoint = '/v1/spider/douyin/video-info';
        payload = { aweme_id: videoId, AwemeID: videoId, share_url: url, analysis_items: normalizedItems };
    }
  }

  return fetchSpiderJson({ gatewayUrl, apiKey, path: endpoint, payload });
};

const handleVideoDiagnosisProbeRequest = async (req, res) => {
  const spiderConfig = getSpiderConfig();
  console.log('[video-diagnosis/probe] apiKey:', spiderConfig.apiKey ? '已配置' : '未配置', 'gatewayUrl:', spiderConfig.gatewayUrl || '未配置');
  if (!spiderConfig.apiKey) {
    respondSpiderConfigMissing(res, 'key');
    return;
  }
  if (!spiderConfig.gatewayUrl) {
    respondSpiderConfigMissing(res, 'gateway');
    return;
  }

  const body = await readBody(req);
  const accessMode = String(body?.accessMode || 'spider_api');
  if (accessMode !== 'spider_api') {
    json(res, 400, {
      message: '当前仅支持 Spider API 模式。',
      code: 'unsupported_access_mode',
    });
    return;
  }

  const platform = String(body?.platform || 'tiktok').toLowerCase();
  const videoUrl = String(body?.url || '');
  const analysisItems = Array.isArray(body?.analysisItems)
    ? body.analysisItems
    : [];

  try {
    const videoDiagnosisProbeRunner = createVideoDiagnosisProbe({
      spiderFetch: createSpiderFetch(spiderConfig),
    });
    const result = await videoDiagnosisProbeRunner({
      platform,
      url: videoUrl,
      analysisItems,
    });
    json(res, 200, result);
  } catch (err) {
    console.error('[video-diagnosis/probe] 未捕获异常:', err);
    json(res, 500, { message: err?.message || '视频诊断勘探失败', code: 'probe_error' });
  }
};

const buildVideoDiagnosisAnalysisPrompt = (diagData, platform) => {
  const d = diagData;
  const platformName = platform === 'douyin' ? '抖音' : platform === 'xhs' ? '小红书' : 'TikTok';

  // 小红书使用独立的 prompt 结构
  if (platform === 'xhs') {
    const noteBlock = JSON.stringify(d.note || {}, null, 2);
    const statsBlock = JSON.stringify(d.statistics || {}, null, 2);
    const hasAuthor = d.author?.fromIndependentFetch;
    const hasRecentNotes = Boolean(d.recentNotes);
    const authorBlock = hasAuthor ? JSON.stringify(d.author, null, 2) : null;
    const recentNotesBlock = hasRecentNotes ? JSON.stringify(d.recentNotes, null, 2) : null;
    const commentBlock = d.commentQuality ? JSON.stringify(d.commentQuality, null, 2) : null;

    const outputSchema = JSON.stringify({
      summary: '一句话总结这条笔记的整体表现，包括亮点和主要问题',
      overallRisk: 'low|medium|high',
      sections: [
        { id: 'account_authority', title: '账号权重与活跃度', level: 'normal|warning|danger', findings: ['具体发现1', '具体发现2'], suggestion: '改进建议' },
        { id: 'content_performance', title: '内容表现与互动质量', level: 'normal|warning|danger', findings: [], suggestion: '' },
        { id: 'content_originality', title: '内容原创性', level: 'normal|warning|danger', findings: [], suggestion: '' },
        { id: 'commercial_signals', title: '商业化与变现能力', level: 'normal|warning|danger', findings: [], suggestion: '' },
        { id: 'audience_targeting', title: '受众定向与话题策略', level: 'normal|warning|danger', findings: [], suggestion: '' },
        { id: 'growth_potential', title: '成长潜力与优化空间', level: 'normal|warning|danger', findings: [], suggestion: '' },
      ],
      topActions: ['优先操作1', '优先操作2', '优先操作3'],
    }, null, 2);

    const lines = [
      'R Role 角色',
      '你是一位专业的小红书内容诊断专家。',
      '',
      'T Task 任务',
      '请基于以下数据对这条小红书笔记进行深度分析。',
      '',
      'C Constraint 约束',
      '1. 客观全面：好的地方明确指出，差的地方给出证据和改进建议。',
      '2. level 判断：normal=表现正常或良好，warning=有改进空间，danger=存在明显问题。',
      '3. findings 必须引用具体字段名和字段值，不要泛泛而谈。',
      '4. 小红书没有平台审核状态字段，不要分析 platform_review 维度。',
      '5. 如果某个维度的数据标注为"数据未获取"，findings 只写 ["暂无相关数据"]，suggestion 写 "暂无相关数据"，level 写 "normal"。',
      '',
      'F Format 格式',
      '请严格按照给定 JSON 格式输出，不要输出任何其他内容。',
      '```json', outputSchema, '```',
      '',
      'E Example 示例',
      '{"summary":"一句话总结","overallRisk":"medium","sections":[{"id":"account_authority","title":"账号权重与活跃度","level":"warning","findings":["follower_count=1200"],"suggestion":"保持稳定更新"}],"topActions":["操作1","操作2","操作3"]}',
      '',
      `## 笔记基础信息`,
      '```json', noteBlock, '```',
      '',
      '## 互动数据',
      '```json', statsBlock, '```',
      '',
    ];

    if (authorBlock) {
      lines.push('## 账号信息', '```json', authorBlock, '```', '');
    } else {
      lines.push('## 账号信息', '（数据未获取，account_authority 维度请输出"暂无相关数据"）', '');
    }

    if (recentNotesBlock) {
      lines.push('## 近期笔记趋势', '```json', recentNotesBlock, '```', '');
    } else {
      lines.push('## 近期笔记趋势', '（数据未获取，content_performance 中的账号均值对比请跳过）', '');
    }

    if (commentBlock) {
      lines.push('## 评论质量抽样', '```json', commentBlock, '```', '');
    } else {
      lines.push('## 评论质量抽样', '（数据未获取）', '');
    }

    lines.push(
      '## sections 必须包含以下6个维度：',
      '',
      '1. account_authority - 账号权重与基础',
      `   ${hasAuthor ? '分析：follower_count（粉丝量）、likedCount（总获赞）、noteCount（笔记数）' : '账号数据未获取，输出暂无相关数据'}`,
      '   好的信号：粉丝多、获赞高、发布频率稳定',
      '   差的信号：新账号/低权重/长期不活跃',
      '',
      '2. content_performance - 内容表现与互动质量',
      '   分析：likedCount、commentCount、collectCount、shareCount、viewCount',
      '   计算：点赞率(liked/view)、评论率(comment/view)、收藏率(collect/view)',
      `   ${hasRecentNotes ? '对比：本笔记 likedCount vs 账号近期 avgLikeCount（是否高于/低于均值）' : '近期笔记数据未获取，跳过均值对比'}`,
      '   好的信号：各项比率健康',
      '   差的信号：互动率极低，可能被限流',
      '',
      '3. content_originality - 内容原创性',
      '   分析：笔记类型（图文/视频）、标题和描述的原创程度',
      '   好的信号：原创内容，有独特视角',
      '   差的信号：内容同质化严重',
      '',
      '4. commercial_signals - 商业化与变现能力',
      '   分析：内容是否有带货/推广属性，话题标签是否涉及品牌合作',
      '   好的信号：内容自然，商业化程度适中',
      '   差的信号：过度营销，影响用户体验',
      '',
      '5. audience_targeting - 受众定向与话题策略',
      '   分析：笔记标题关键词、描述中的话题标签，是否精准定向目标受众',
      '   好的信号：话题标签精准，与内容高度相关',
      '   差的信号：话题标签泛化或与内容不匹配',
      '',
      '6. growth_potential - 成长潜力与优化空间',
      '   综合以上所有有数据的维度，给出整体评估',
      '   指出最大的优势是什么，最需要改进的1-2个点是什么',
      '   给出具体可执行的优化建议',
      '',
      'topActions 给出3-5条最优先的可执行操作，按优先级排序。',
    );

    return lines.join('\n');
  }

  const videoBlock = JSON.stringify(d.video || {}, null, 2);
  const statsBlock = JSON.stringify(d.statistics || {}, null, 2);
  const authorBlock = JSON.stringify(d.author || {}, null, 2);
  const platformStatusBlock = JSON.stringify(d.platformStatus || {}, null, 2);
  const originalityBlock = JSON.stringify(d.originality || {}, null, 2);
  const commerceBlock = JSON.stringify(d.commerce || {}, null, 2);
  const riskBlock = JSON.stringify(d.risk || {}, null, 2);
  const recentPostsBlock = d.recentPosts ? JSON.stringify(d.recentPosts, null, 2) : '（未获取）';
  const commentBlock = d.commentQuality ? JSON.stringify(d.commentQuality, null, 2) : '（未获取）';
  const musicBlock = d.musicDetail ? JSON.stringify(d.musicDetail, null, 2) : '（未获取）';

  const outputSchema = JSON.stringify({
    summary: '一句话总结这条视频的整体表现，包括亮点和主要问题',
    overallRisk: 'low|medium|high',
    sections: [
      {
        id: 'account_authority',
        title: '账号权重与活跃度',
        level: 'normal|warning|danger',
        findings: ['引用具体字段值，例如：follower_count=434365，粉丝基础扎实，total_favorited=23874362 说明历史内容质量高'],
        suggestion: '针对性建议（好的继续保持，差的给出改进方向）',
      },
    ],
    topActions: ['最优先操作1', '最优先操作2', '最优先操作3'],
  }, null, 2);

  return [
    'R Role 角色',
    `你是一位资深的${platformName}平台算法与运营专家。`,
    '',
    'T Task 任务',
    '根据以下视频的多维度后台数据，输出一份全面的视频诊断分析报告。',
    '这不只是限流诊断，你需要全面评估这条视频：哪里做得好、哪里有问题、哪里有提升空间。',
    '',
    'C Constraint 约束',
    '1. 数据来源：视频详情 + 账号画像 + 近期作品趋势 + 评论质量 + 音乐信息（部分平台/视频可能未获取）。',
    '2. 客观全面：好的地方明确指出，差的地方给出证据和改进建议。',
    '3. level 判断：normal=表现正常或良好，warning=有改进空间，danger=存在明显问题。',
    '4. findings 必须引用具体字段名和字段值，不要泛泛而谈。',
    '',
    'F Format 格式',
    '请严格按照以下 JSON 格式输出，不要输出任何其他内容：',
    '```json', outputSchema, '```',
    '',
    'E Example 示例',
    '{"summary":"一句话总结","overallRisk":"low","sections":[{"id":"account_authority","title":"账号权重与活跃度","level":"normal","findings":["follower_count=434365"],"suggestion":"保持更新频率"}],"topActions":["操作1","操作2","操作3"]}',
    '',
    '',
    '## 视频基础信息',
    '```json', videoBlock, '```',
    '',
    '## 互动数据',
    '```json', statsBlock, '```',
    '',
    '## 账号画像',
    '```json', authorBlock, '```',
    '',
    '## 平台审核状态',
    '```json', platformStatusBlock, '```',
    '',
    '## 原创性信号',
    '```json', originalityBlock, '```',
    '',
    '## 商业化信号',
    '```json', commerceBlock, '```',
    '',
    '## 风险标签',
    '```json', riskBlock, '```',
    '',
    '## 近期作品趋势（近6条）',
    '```json', recentPostsBlock, '```',
    '',
    '## 评论质量抽样',
    '```json', commentBlock, '```',
    '',
    '## 音乐详情',
    '```json', musicBlock, '```',
    '',
    '## sections 必须包含以下8个维度：',
    '',
    '1. account_authority - 账号权重与基础',
    '   分析：follower_count（粉丝量）、total_favorited（总获赞）、aweme_count（作品数）、with_commerce_entry（商业化权限）',
    '   好的信号：粉丝多、获赞高、发布频率稳定',
    '   差的信号：新账号/低权重/长期不活跃',
    '',
    '2. content_performance - 内容表现与互动质量',
    '   分析：play_count、digg_count、comment_count、share_count、collect_count',
    '   计算：点赞率(digg/play)、评论率(comment/play)、分享率(share/play)',
    '   对比：本视频 playCount vs 账号近期 avgPlayCount（是否高于/低于均值）',
    '   评论质量：withReplies 比例、avgDigg、评论内容是否真实有价值',
    '   好的信号：各项比率健康，高于账号均值，评论有实质内容',
    '   差的信号：播放量远低于账号均值（可能被限流），互动率极低',
    '',
    '3. content_originality - 内容原创性',
    '   分析：content_original_type（2=原创）、aigc.created_by_ai、music.is_original',
    '   music.user_count（使用人数多=热门音乐，安全；=1=原声）',
    '   好的信号：原创内容，使用热门或原声音乐',
    '   差的信号：非原创、AI生成、音乐被限制',
    '',
    '4. platform_review - 平台审核与分发状态',
    '   分析：review_status（0=通过）、is_prohibited（false=正常）、private_status（0=公开）',
    '   allow_comment、allow_share、download_status',
    '   好的信号：全部状态正常，无限制',
    '   差的信号：任何字段异常，或状态正常但播放量极低（软限流）',
    '',
    '5. commercial_signals - 商业化与变现能力',
    '   分析：has_promote_entry（是否可推广）、with_commerce_entry（商业化权限）',
    '   is_ads、is_paid_content、commerce_info',
    '   好的信号：有商业化权限，内容自然不过度营销',
    '   差的信号：过度商业化信号触发算法降权，或完全没有商业化能力',
    '',
    '6. music_strategy - 音乐策略',
    '   分析：music.title、music.user_count（使用人数）、music.is_original、music.status',
    '   好的信号：使用热门音乐（user_count 高）或原声（user_count=1 且内容质量好）',
    '   差的信号：使用冷门/被限制音乐，music.status 异常',
    '',
    '7. audience_targeting - 受众定向与地区匹配',
    '   分析：video.region、video.descLanguage、author.region 三者匹配度',
    '   desc 中的语言、hashtag 是否与目标市场一致',
    '   好的信号：region/语言/hashtag 三者一致，精准定向',
    '   差的信号：region 与内容语言不匹配，推流方向混乱',
    '',
    '8. growth_potential - 成长潜力与优化空间',
    '   综合以上所有维度，给出这条视频/账号的整体评估',
    '   指出最大的优势是什么，最需要改进的1-2个点是什么',
    '   给出具体可执行的优化建议',
    '',
    'topActions 给出3-5条最优先的可执行操作，按优先级排序，好的继续保持，差的给出改进方向。',
  ].join('\n');
};

const handleVideoDiagnosisAnalyzeRequest = async (req, res) => {
  const body = await readBody(req);
  const diagData = body?.diagData;
  const platform = String(body?.platform || 'tiktok').toLowerCase();
  const model = String(body?.model || '').trim();

  if (!diagData || typeof diagData !== 'object') {
    json(res, 400, { message: '缺少 diagData', code: 'missing_diag_data' });
    return;
  }
  if (!model) {
    json(res, 400, { message: '缺少 model', code: 'missing_model' });
    return;
  }

  const prompt = buildVideoDiagnosisAnalysisPrompt(diagData, platform);
  const messages = [{ role: 'user', content: prompt }];

  let output;
  try {
    output = await executeProviderJobWithManagedAssetScrub(
      { taskType: 'kie_chat', payload: { messages, model } },
      process.env,
      new AbortController().signal
    );
  } catch (error) {
    console.error('[video-diagnosis/analyze] AI调用失败:', error?.message, '| code:', error?.code, '| providerMessage:', error?.providerMessage);
    json(res, 500, {
      message: error?.providerMessage || error?.message || 'AI 分析失败',
      code: error?.code || 'ai_error',
    });
    return;
  }

  const rawContent = String(output?.result?.content || '').trim();
  // 尝试提取 JSON
  const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/(\{[\s\S]*\})/);
  let parsed = null;
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[1].trim()); } catch (_) {}
  }
  if (!parsed) {
    try { parsed = JSON.parse(rawContent); } catch (_) {}
  }

  json(res, 200, {
    analysis: parsed || { summary: rawContent, sections: [], topActions: [], overallRisk: 'unknown' },
    rawContent,
  });
};

const serveStaticFile = (req, res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);
  const relativePath = path.relative(distDir, filePath).replace(/\\/g, '/');
  const isHtmlEntry = ext === '.html';
  const isHashedAsset = relativePath.startsWith('assets/') && /\-[A-Za-z0-9_-]{6,}\./.test(path.basename(filePath));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': isHtmlEntry
      ? 'no-store, no-cache, must-revalidate'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

const safeDecodePathname = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const tryServeFrontend = (req, res, url) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (!existsSync(distDir)) return false;

  const normalizedPath = safeDecodePathname(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!normalizedPath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Malformed path');
    return true;
  }
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const targetPath = path.resolve(distDir, relativePath);

  if (!targetPath.startsWith(distDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  if (existsSync(targetPath)) {
    const targetStats = statSync(targetPath);
    if (targetStats.isFile()) {
      serveStaticFile(req, res, targetPath);
      return true;
    }
  }

  if (relativePath.startsWith('assets/')) {
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end('Asset not found');
    return true;
  }

  const fallbackPath = path.join(distDir, 'index.html');
  if (existsSync(fallbackPath)) {
    serveStaticFile(req, res, fallbackPath);
    return true;
  }

  return false;
};

const cleanUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl || '',
  avatarPreset: user.avatarPreset || 'aurora',
  role: user.role,
  isSuperAdmin: isSuperAdminUser(user),
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
  jobConcurrency: normalizeJobConcurrency(user.jobConcurrency, DEFAULT_JOB_CONCURRENCY),
  featurePermissions: normalizeFeaturePermissions(user.featurePermissions),
  analysisModel: normalizeUserAnalysisModel(user.analysisModel),
  creditLimitMode: user.creditLimitMode,
  creditBalance: normalizeCreditBalanceInput(user.creditBalance),
  creditReserved: normalizeCreditBalanceInput(user.creditReserved),
  creditConsumed: normalizeCreditBalanceInput(user.creditConsumed),
  creditAvailable: getCreditAvailable(user),
});

const localCreateSession = (store, userId) => {
  const token = randomBytes(24).toString('hex');
  store.sessions = store.sessions.filter(session => session.userId !== userId);
  store.sessions.push({
    token,
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
};

const localGetSessionUser = (req, store) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;

  const now = Date.now();
  store.sessions = store.sessions.filter(session => session.expiresAt > now);
  const session = store.sessions.find(item => item.token === token);
  if (!session) return null;
  return store.users.find(user => user.id === session.userId && user.status === 'active') || null;
};

const localRequireUser = (req, res, store) => {
  const user = localGetSessionUser(req, store);
  if (!user) {
    json(res, 401, { message: '登录状态已失效，请重新登录。' });
    return null;
  }
  return user;
};

const localRequireAdmin = (req, res, store) => {
  const user = localRequireUser(req, res, store);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: '只有管理员可以执行这个操作。' });
    return null;
  }
  return user;
};

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
};

const getMysqlPool = async () => {
  if (!shouldUseMysql) return null;

  if (!mysql) {
    mysql = await import('mysql2/promise');
  }

  const createPool = () => mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });

  const resetPool = async (stalePool = mysqlPool) => {
    if (mysqlPool === stalePool) {
      mysqlPool = null;
    }
    mysqlPoolHealthCheckPromise = null;
    if (stalePool?.end) {
      await stalePool.end().catch(() => null);
    }
  };

  if (!mysqlPool) {
    mysqlPool = createPool();
  }

  if (!mysqlPoolHealthCheckPromise) {
    const poolForHealthCheck = mysqlPool;
    mysqlPoolHealthCheckPromise = (async () => {
      try {
        await poolForHealthCheck.query('SELECT 1');
      } catch (error) {
        if (isTransientMysqlConnectionError(error)) {
          await resetPool(poolForHealthCheck);
          if (!mysqlPool) {
            mysqlPool = createPool();
          }
          await mysqlPool.query('SELECT 1');
          return;
        }
        throw error;
      }
    })().finally(() => {
      mysqlPoolHealthCheckPromise = null;
    });
  }

  await mysqlPoolHealthCheckPromise;
  if (!mysqlPool) {
    mysqlPool = createPool();
  }
  return mysqlPool;
};

const getManagedAssetUserLockTimeoutSeconds = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_ASSET_USER_LOCK_TIMEOUT_SECONDS ?? 30), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 120)) : 30;
};

const getManagedAssetLockConnectionLimit = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_ASSET_LOCK_CONNECTION_LIMIT ?? 20), 10);
  return Number.isFinite(parsed) ? Math.max(2, Math.min(parsed, 100)) : 20;
};

const getManagedAssetLockPool = async () => {
  await getMysqlPool();
  if (!mysqlManagedAssetLockPool) {
    mysqlManagedAssetLockPool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: getManagedAssetLockConnectionLimit(),
      queueLimit: 0,
      charset: 'utf8mb4',
    });
  }
  return mysqlManagedAssetLockPool;
};

const getManagedAssetUserLockName = (userId) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    const error = new Error('托管素材操作缺少账号归属');
    error.code = 'managed_asset_owner_unavailable';
    error.statusCode = 409;
    throw error;
  }
  return `meiao:managed-asset-user:${normalizedUserId}`.slice(0, 64);
};

const acquireManagedAssetUserLock = async (connection, userId) => {
  const lockName = getManagedAssetUserLockName(userId);
  const [rows] = await connection.query(
    'SELECT GET_LOCK(?, ?) AS acquired',
    [lockName, getManagedAssetUserLockTimeoutSeconds()],
  );
  if (Number(rows?.[0]?.acquired) !== 1) {
    const error = new Error('同账号素材正在上传或清理，请稍后重试');
    error.code = 'managed_asset_user_lock_timeout';
    error.statusCode = 409;
    throw error;
  }
  return lockName;
};

const releaseManagedAssetUserLock = async (connection, lockName) => {
  if (!lockName) return;
  await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
};

const acquireManagedAssetNamedLock = async (connection, lockName, message) => {
  const [rows] = await connection.query(
    'SELECT GET_LOCK(?, ?) AS acquired',
    [lockName, getManagedAssetUserLockTimeoutSeconds()],
  );
  if (Number(rows?.[0]?.acquired) !== 1) {
    const error = new Error(message);
    error.code = 'managed_asset_lifecycle_lock_timeout';
    error.statusCode = 409;
    throw error;
  }
  return lockName;
};

const getManagedAssetAgentLockName = (agentId) => {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) {
    const error = new Error('托管素材操作缺少智能体归属');
    error.code = 'managed_asset_agent_unavailable';
    error.statusCode = 409;
    throw error;
  }
  return `meiao:managed-asset-agent:${normalizedAgentId}`.slice(0, 64);
};

const acquireManagedAssetAgentLock = async (connection, agentId) => acquireManagedAssetNamedLock(
  connection,
  getManagedAssetAgentLockName(agentId),
  '该智能体的素材正在写入或清理，请稍后重试',
);

const getManagedAssetAgentOwnerLockName = (userId) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    const error = new Error('托管素材操作缺少智能体账号归属');
    error.code = 'managed_asset_owner_unavailable';
    error.statusCode = 409;
    throw error;
  }
  return `meiao:managed-asset-agent-owner:${normalizedUserId}`.slice(0, 64);
};

const acquireManagedAssetAgentOwnerLock = async (connection, userId) => acquireManagedAssetNamedLock(
  connection,
  getManagedAssetAgentOwnerLockName(userId),
  '该账号的智能体正在变更或清理，请稍后重试',
);

const acquireManagedAssetLocks = async (connection, values, acquire) => {
  const normalizedValues = Array.from(new Set(
    (values || []).map((value) => String(value || '').trim()).filter(Boolean),
  )).sort();
  const lockNames = [];
  try {
    for (const value of normalizedValues) {
      lockNames.push(await acquire(connection, value));
    }
    return lockNames;
  } catch (error) {
    for (const lockName of lockNames.reverse()) {
      await releaseManagedAssetUserLock(connection, lockName).catch(() => null);
    }
    throw error;
  }
};

const acquireManagedAssetAgentLocks = async (connection, agentIds) => acquireManagedAssetLocks(
  connection,
  agentIds,
  acquireManagedAssetAgentLock,
);

const acquireManagedAssetUserLocks = async (connection, userIds) => acquireManagedAssetLocks(
  connection,
  userIds,
  acquireManagedAssetUserLock,
);

const releaseManagedAssetLocks = async (connection, lockNames) => {
  for (const lockName of [...(lockNames || [])].reverse()) {
    await releaseManagedAssetUserLock(connection, lockName).catch(() => null);
  }
};

const localManagedAssetUserLockTails = new Map();
const withLocalManagedAssetUserLock = async (userId, operation) => {
  const lockKey = String(userId || '').trim();
  if (!lockKey) return operation();
  const prior = localManagedAssetUserLockTails.get(lockKey) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = prior.catch(() => null).then(() => current);
  localManagedAssetUserLockTails.set(lockKey, tail);
  await prior.catch(() => null);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (localManagedAssetUserLockTails.get(lockKey) === tail) {
      localManagedAssetUserLockTails.delete(lockKey);
    }
  }
};

// Local JSON mode persists the entire application store in one file. Serialize
// every mutating request before it reads that snapshot, otherwise a slow request
// can overwrite a newer account/session deletion with its stale full-store copy.
const withLocalStoreMutationLock = async (operation) => (
  withLocalManagedAssetUserLock('__local_store_mutation__', operation)
);

const mutateLocalStore = async (operation) => withLocalStoreMutationLock(async () => {
  const store = readLocalStore();
  const result = await operation(store);
  writeLocalStore(store);
  return result;
});

const withManagedAssetUserLock = async (userId, operation) => {
  const pool = await getMysqlPool();
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let lockName = '';
  try {
    lockName = await acquireManagedAssetUserLock(connection, userId);
    return await operation(pool);
  } finally {
    if (lockName) {
      await releaseManagedAssetUserLock(connection, lockName).catch(() => null);
    }
    connection.release();
  }
};

const shouldSuppressAppStateBinlog = () => process.env.MEIAO_DB_SUPPRESS_APP_STATE_BINLOG !== '0';

const redactAppStateWriteError = (error) => {
  if (!error || typeof error !== 'object') return error;
  error.sql = '[redacted app_states write sql]';
  error.sqlMessage = String(error.sqlMessage || error.message || 'app_states write failed').slice(0, 500);
  error.sqlState = error.sqlState ? String(error.sqlState).slice(0, 20) : error.sqlState;
  return error;
};

const runAppStateWriteWithoutBinlog = async (pool, sql, params) => {
  const connection = await pool.getConnection();
  let binlogSuppressed = false;
  try {
    if (shouldSuppressAppStateBinlog()) {
      try {
        await connection.query('SET SESSION sql_log_bin = 0');
        binlogSuppressed = true;
      } catch (error) {
        if (!warnedAppStateBinlogDisableFailure) {
          warnedAppStateBinlogDisableFailure = true;
          console.warn(`Unable to suppress MySQL binlog for app_state writes: ${error?.message || error}`);
        }
      }
    }
    return await connection.query(sql, params);
  } catch (error) {
    throw redactAppStateWriteError(error);
  } finally {
    if (binlogSuppressed) {
      await connection.query('SET SESSION sql_log_bin = 1').catch((error) => {
        console.warn(`Unable to restore MySQL binlog after app_state write: ${error?.message || error}`);
      });
    }
    connection.release();
  }
};

const ensureMysqlSchema = async () => {
  const pool = await getMysqlPool();
  if (!pool) return;

  const ensureMysqlColumn = async (pool, tableName, columnName, definition) => {
    const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(24) PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      avatar_url VARCHAR(1024) NULL,
      avatar_preset VARCHAR(40) NULL,
      role VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      job_concurrency INT NOT NULL DEFAULT 5,
      feature_permissions_json LONGTEXT NULL,
      analysis_model VARCHAR(120) NULL,
      password_hash VARCHAR(128) NOT NULL,
      salt VARCHAR(64) NOT NULL,
      created_at BIGINT NOT NULL,
      last_login_at BIGINT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const [jobConcurrencyColumns] = await pool.query(`SHOW COLUMNS FROM users LIKE 'job_concurrency'`);
  if (!Array.isArray(jobConcurrencyColumns) || jobConcurrencyColumns.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN job_concurrency INT NOT NULL DEFAULT 5 AFTER status');
  }
  await ensureMysqlColumn(pool, 'users', 'avatar_url', 'VARCHAR(1024) NULL');
  await ensureMysqlColumn(pool, 'users', 'avatar_preset', 'VARCHAR(40) NULL');
  await ensureMysqlColumn(pool, 'users', 'feature_permissions_json', 'LONGTEXT NULL');
  await ensureMysqlColumn(pool, 'users', 'analysis_model', 'VARCHAR(120) NULL');
  await ensureMysqlColumn(pool, 'users', 'credit_limit_mode', "VARCHAR(20) NOT NULL DEFAULT 'unlimited'");
  await ensureMysqlColumn(pool, 'users', 'credit_balance', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'users', 'credit_reserved', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'users', 'credit_consumed', 'DECIMAL(12,2) NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_credit_ledger (
      id VARCHAR(24) PRIMARY KEY,
      reservation_id VARCHAR(24) NULL,
      user_id VARCHAR(24) NOT NULL,
      job_id VARCHAR(24) NULL,
      request_id VARCHAR(80) NULL,
      module VARCHAR(60) NULL,
      task_type VARCHAR(80) NULL,
      provider VARCHAR(40) NULL,
      action VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance_after DECIMAL(12,2) NOT NULL DEFAULT 0,
      reserved_after DECIMAL(12,2) NOT NULL DEFAULT 0,
      reason VARCHAR(120) NULL,
      meta_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_account_credit_reservation_id (reservation_id),
      INDEX idx_account_credit_user_id (user_id),
      INDEX idx_account_credit_job_id (job_id),
      INDEX idx_account_credit_created_at (created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'account_credit_ledger', 'reservation_id', 'VARCHAR(24) NULL AFTER id');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_sessions_user_id (user_id),
      INDEX idx_sessions_expires_at (expires_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_states (
      user_id VARCHAR(24) PRIMARY KEY,
      state_json LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  const [appStateUpdatedAtIndexes] = await pool.query(
    "SHOW INDEX FROM app_states WHERE Key_name = 'idx_app_states_updated_at'",
  );
  if (!Array.isArray(appStateUpdatedAtIndexes) || appStateUpdatedAtIndexes.length === 0) {
    await pool.query('ALTER TABLE app_states ADD INDEX idx_app_states_updated_at (updated_at)');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_logs (
      id VARCHAR(24) PRIMARY KEY,
      created_at BIGINT NOT NULL,
      level VARCHAR(20) NOT NULL,
      module VARCHAR(60) NOT NULL,
      action VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      detail LONGTEXT NULL,
      status VARCHAR(20) NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      meta_json LONGTEXT NULL,
      INDEX idx_internal_logs_created_at (created_at),
      INDEX idx_internal_logs_user_id (user_id),
      INDEX idx_internal_logs_module (module)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      stat_date DATE NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      module VARCHAR(60) NOT NULL,
      success_count INT DEFAULT 0,
      failed_count INT DEFAULT 0,
      interrupted_count INT DEFAULT 0,
      credits_consumed DECIMAL(12,2) DEFAULT 0,
      PRIMARY KEY (stat_date, user_id, module),
      INDEX idx_usage_daily_date (stat_date),
      INDEX idx_usage_daily_user (user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'usage_daily', 'credits_consumed', 'DECIMAL(12,2) DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id VARCHAR(24) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      department VARCHAR(120) NOT NULL,
      owner_user_id VARCHAR(24) NOT NULL,
      visibility_scope VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL,
      current_version_id VARCHAR(24) NULL,
      icon_url VARCHAR(1024) NULL,
      avatar_preset VARCHAR(40) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_agents_owner_user_id (owner_user_id),
      INDEX idx_agents_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'agents', 'icon_url', 'VARCHAR(1024) NULL');
  await ensureMysqlColumn(pool, 'agents', 'avatar_preset', 'VARCHAR(40) NULL');
  await ensureMysqlColumn(pool, 'agents', 'factory_agent_id', 'VARCHAR(120) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id VARCHAR(24) PRIMARY KEY,
      agent_id VARCHAR(24) NOT NULL,
      version_no INT NOT NULL,
      version_name VARCHAR(160) NOT NULL,
      allowed_chat_models_json LONGTEXT NULL,
      default_chat_model VARCHAR(80) NULL,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      system_prompt LONGTEXT NOT NULL,
      reply_style_rules_json LONGTEXT NOT NULL,
      model_policy_json LONGTEXT NOT NULL,
      context_policy_json LONGTEXT NOT NULL,
      retrieval_policy_json LONGTEXT NOT NULL,
      tool_policy_json LONGTEXT NOT NULL,
      knowledge_document_bindings_json LONGTEXT NULL,
      validation_status VARCHAR(20) NOT NULL,
      validation_summary_json LONGTEXT NULL,
      created_by VARCHAR(24) NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_agent_versions_agent_id (agent_id),
      INDEX idx_agent_versions_published (is_published)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'agent_versions', 'version_name', `VARCHAR(160) NOT NULL DEFAULT 'V1'`);
  await ensureMysqlColumn(pool, 'agent_versions', 'allowed_chat_models_json', 'LONGTEXT NULL');
  await ensureMysqlColumn(pool, 'agent_versions', 'default_chat_model', 'VARCHAR(80) NULL');
  await ensureMysqlColumn(pool, 'agent_versions', 'knowledge_document_bindings_json', 'LONGTEXT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_version_knowledge_bases (
      id VARCHAR(24) PRIMARY KEY,
      agent_version_id VARCHAR(24) NOT NULL,
      knowledge_base_id VARCHAR(24) NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      INDEX idx_avkb_version_id (agent_version_id),
      INDEX idx_avkb_knowledge_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id VARCHAR(24) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      department VARCHAR(120) NOT NULL,
      owner_user_id VARCHAR(24) NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_knowledge_bases_owner_user_id (owner_user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'knowledge_bases', 'factory_agent_id', 'VARCHAR(120) NULL');
  await ensureMysqlColumn(pool, 'knowledge_bases', 'factory_kb_id', 'VARCHAR(120) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id VARCHAR(24) PRIMARY KEY,
      knowledge_base_id VARCHAR(24) NOT NULL,
      title VARCHAR(255) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      chunk_strategy VARCHAR(20) NOT NULL DEFAULT 'general',
      storage_asset_id VARCHAR(24) NULL,
      raw_text LONGTEXT NOT NULL,
      normalization_enabled TINYINT(1) NOT NULL DEFAULT 0,
      normalized_text LONGTEXT NULL,
      normalization_error TEXT NULL,
      normalized_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      chunk_source VARCHAR(20) NOT NULL DEFAULT 'raw',
      parse_status VARCHAR(20) NOT NULL,
      chunk_count INT NOT NULL DEFAULT 0,
      created_by VARCHAR(24) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_knowledge_documents_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'knowledge_documents', 'chunk_strategy', "VARCHAR(20) NOT NULL DEFAULT 'general'");
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalization_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalization_error', 'TEXT NULL');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalized_text', 'LONGTEXT NULL');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalized_status', "VARCHAR(20) NOT NULL DEFAULT 'idle'");
  await ensureMysqlColumn(pool, 'knowledge_documents', 'chunk_source', "VARCHAR(20) NOT NULL DEFAULT 'raw'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value_json LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id VARCHAR(24) PRIMARY KEY,
      document_id VARCHAR(24) NOT NULL,
      knowledge_base_id VARCHAR(24) NOT NULL,
      chunk_index INT NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      content LONGTEXT NOT NULL,
      token_estimate INT NOT NULL DEFAULT 0,
      embedding_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_knowledge_chunks_document_id (document_id),
      INDEX idx_knowledge_chunks_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      agent_id VARCHAR(24) NOT NULL,
      agent_version_id VARCHAR(24) NOT NULL,
      title VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL,
      summary LONGTEXT NULL,
      selected_model VARCHAR(80) NOT NULL,
      reasoning_level VARCHAR(40) NULL,
      web_search_enabled TINYINT(1) NOT NULL DEFAULT 0,
      last_image_mode TINYINT(1) NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_chat_sessions_user_id (user_id),
      INDEX idx_chat_sessions_agent_id (agent_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'chat_sessions', 'selected_model', 'VARCHAR(80) NOT NULL DEFAULT ""');
  await ensureMysqlColumn(pool, 'chat_sessions', 'reasoning_level', 'VARCHAR(40) NULL');
  await ensureMysqlColumn(pool, 'chat_sessions', 'web_search_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'chat_sessions', 'last_image_mode', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'chat_sessions', 'is_studio', 'TINYINT(1) NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(24) PRIMARY KEY,
      session_id VARCHAR(24) NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      role VARCHAR(20) NOT NULL,
      content LONGTEXT NOT NULL,
      attachments_json LONGTEXT NULL,
      metadata_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_chat_messages_session_id (session_id),
      INDEX idx_chat_messages_user_id (user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_usage_logs (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      agent_id VARCHAR(24) NOT NULL,
      agent_name VARCHAR(120) NOT NULL,
      agent_version_id VARCHAR(24) NOT NULL,
      session_id VARCHAR(24) NULL,
      request_type VARCHAR(40) NOT NULL,
      selected_model VARCHAR(80) NOT NULL,
      used_retrieval TINYINT(1) NOT NULL DEFAULT 0,
      retrieval_summary_json LONGTEXT NULL,
      prompt_tokens INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      estimated_cost DECIMAL(12,6) NOT NULL DEFAULT 0,
      latency_ms INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      error_message TEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_agent_usage_logs_agent_id (agent_id),
      INDEX idx_agent_usage_logs_user_id (user_id),
      INDEX idx_agent_usage_logs_created_at (created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await ensureJobsSchema(pool);
  await ensureTaskPlatformSchema(pool);
  await ensureAssetSchema(pool);
  await ensureVirtualModelSchema(pool);

  const [rows] = await pool.query('SELECT id FROM users LIMIT 1');
  if (Array.isArray(rows) && rows.length === 0) {
    const admin = createUser({
      username: process.env.MEIAO_ADMIN_USERNAME || 'admin',
      password: process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });

    await pool.query(
      `INSERT INTO users (id, username, display_name, avatar_url, avatar_preset, role, status, job_concurrency, feature_permissions_json, analysis_model, password_hash, salt, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin.id,
        admin.username,
        admin.displayName,
        admin.avatarUrl || null,
        admin.avatarPreset || 'aurora',
        admin.role,
        admin.status,
        admin.jobConcurrency,
        serializeFeaturePermissions(admin.featurePermissions),
        normalizeUserAnalysisModel(admin.analysisModel),
        admin.passwordHash,
        admin.salt,
        admin.createdAt,
        admin.lastLoginAt,
      ]
    );

    await runAppStateWriteWithoutBinlog(pool,
      'INSERT INTO app_states (user_id, state_json, updated_at) VALUES (?, ?, ?)',
      [admin.id, JSON.stringify(createDefaultState()), Date.now()]
    );
  }
};

const mapDbUser = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  avatarUrl: row.avatar_url || '',
  avatarPreset: row.avatar_preset || 'aurora',
  role: row.role,
  status: row.status,
  jobConcurrency: normalizeJobConcurrency(row.job_concurrency, DEFAULT_JOB_CONCURRENCY),
  featurePermissions: normalizeFeaturePermissions(row.feature_permissions_json),
  analysisModel: normalizeUserAnalysisModel(row.analysis_model),
  creditLimitMode: normalizeCreditLimitMode(row.credit_limit_mode),
  creditBalance: normalizeCreditBalanceInput(row.credit_balance),
  creditReserved: normalizeCreditBalanceInput(row.credit_reserved),
  creditConsumed: normalizeCreditBalanceInput(row.credit_consumed),
  passwordHash: row.password_hash,
  salt: row.salt,
  createdAt: Number(row.created_at),
  lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
});

const findDbUserByUsername = async (username) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ? AND status = ? LIMIT 1',
    [username, 'active']
  );
  return rows[0] ? mapDbUser(rows[0]) : null;
};

const findDbUserById = async (userId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE id = ? AND status = ? LIMIT 1',
    [userId, 'active']
  );
  return rows[0] ? mapDbUser(rows[0]) : null;
};

const findAnyDbUserById = async (userId, poolOverride = null) => {
  const pool = poolOverride || await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  return rows[0] ? mapDbUser(rows[0]) : null;
};

const assertActiveDbUserUnderManagedAssetLock = async (pool, userId, message = '账号已停用或不存在') => {
  const owner = await findAnyDbUserById(userId, pool);
  if (owner?.status === 'active') return owner;
  const error = new Error(message);
  error.code = 'managed_asset_owner_unavailable';
  error.statusCode = 409;
  throw error;
};

const listDbUsers = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  return rows.map(mapDbUser);
};

const getConfiguredWorkerConcurrency = () => {
  const configured = Number.parseInt(process.env.MEIAO_JOB_MAX_CONCURRENCY || '5', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
};

const getDbWorkerConcurrency = async () => {
  const users = await listDbUsers();
  return getWorkerConcurrencyLimit(getConfiguredWorkerConcurrency(), users);
};

const getLocalWorkerConcurrency = () => {
  const store = readLocalStore();
  return getWorkerConcurrencyLimit(getConfiguredWorkerConcurrency(), store.users || []);
};

const updateDbUserLoginTime = async (userId, loginTime) => {
  const pool = await getMysqlPool();
  await pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [loginTime, userId]);
};

const ensureDbAppState = async (userId) => {
  await withManagedAssetUserLock(userId, async (pool) => {
    await assertActiveDbUserUnderManagedAssetLock(pool, userId, '账号已删除，未初始化项目状态');
    const [rows] = await pool.query('SELECT user_id FROM app_states WHERE user_id = ? LIMIT 1', [userId]);
    if (rows[0]) return;
    await runAppStateWriteWithoutBinlog(pool,
      'INSERT INTO app_states (user_id, state_json, updated_at) VALUES (?, ?, ?)',
      [userId, JSON.stringify(createDefaultState()), Date.now()]
    );
  });
};

const getDbAppState = async (userId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT state_json FROM app_states WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (!rows[0]?.state_json) {
    await ensureDbAppState(userId);
    return prepareStateForStorage(createDefaultState());
  }

  return prepareStateForStorage(JSON.parse(rows[0].state_json));
};

const getDbAppStateUnderManagedAssetLock = async (userId, pool) => {
  const [rows] = await pool.query(
    'SELECT state_json FROM app_states WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0]?.state_json
    ? prepareStateForStorage(JSON.parse(rows[0].state_json))
    : prepareStateForStorage(createDefaultState());
};

const saveDbAppState = async (userId, state) => {
  const preparedState = prepareStateForStorage(state);
  const serializedState = JSON.stringify(preparedState);
  await runWithTransientRetry(
    async () => {
      return withManagedAssetUserLock(userId, async (pool) => {
        await assertActiveDbUserUnderManagedAssetLock(pool, userId, '账号已删除，未保存项目状态');
        return runAppStateWriteWithoutBinlog(pool,
          `INSERT INTO app_states (user_id, state_json, updated_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)`,
          [userId, serializedState, Date.now()]
        );
      });
    },
    {
      onRetry: ({ attempt, delay }) => {
        console.warn(`[app_states] transient write error, retry ${attempt + 1} after ${delay}ms (user ${userId})`);
      },
    },
  );
};

const saveDbAppStateAndQueueRemovedAssetsUnderLock = async ({
  lockResource: pool,
  user,
  previousState,
  nextState,
}) => {
  const preparedState = prepareStateForStorage(nextState);
  const serializedState = JSON.stringify(preparedState);
  return runWithTransientRetry(async () => {
    let connection = null;
    let binlogSuppressed = false;
    let transactionStarted = false;
    try {
      connection = await pool.getConnection();
      if (shouldSuppressAppStateBinlog()) {
        try {
          await connection.query('SET SESSION sql_log_bin = 0');
          binlogSuppressed = true;
        } catch (error) {
          if (!warnedAppStateBinlogDisableFailure) {
            warnedAppStateBinlogDisableFailure = true;
            console.warn(`Unable to suppress MySQL binlog for transactional app_state writes: ${error?.message || error}`);
          }
        }
      }
      await connection.beginTransaction();
      transactionStarted = true;
      await assertActiveDbUserUnderManagedAssetLock(connection, user.id, '账号已删除，未保存项目状态');
      await assertOwnedActiveManagedAssetReferences({
        value: preparedState,
        userId: user.id,
        pool: connection,
      });
      await connection.query(
        `INSERT INTO app_states (user_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)`,
        [user.id, serializedState, Date.now()],
      );
      await queueRemovedStateAssetsForCleanup({
        user,
        previousState,
        nextState: preparedState,
        poolOverride: connection,
      });
      await connection.commit();
      transactionStarted = false;
      return preparedState;
    } catch (error) {
      if (transactionStarted) await connection.rollback().catch(() => {});
      throw redactAppStateWriteError(error);
    } finally {
      if (binlogSuppressed && connection) {
        await connection.query('SET SESSION sql_log_bin = 1').catch((error) => {
          console.warn(`Unable to restore MySQL binlog after transactional app_state write: ${error?.message || error}`);
        });
      }
      connection?.release();
    }
  }, {
    onRetry: ({ attempt, delay }) => {
      console.warn(`[app_states] transient transactional write error, retry ${attempt + 1} after ${delay}ms (user ${user.id})`);
    },
  });
};

const getDbSystemSettings = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT setting_value_json FROM system_settings WHERE setting_key = ? LIMIT 1',
    ['global']
  );
  if (!rows[0]?.setting_value_json) {
    return createDefaultSystemSettings();
  }
  try {
    return normalizeSystemSettings(JSON.parse(rows[0].setting_value_json));
  } catch {
    return createDefaultSystemSettings();
  }
};

const saveDbSystemSettings = async (settings) => {
  const pool = await getMysqlPool();
  const normalized = normalizeSystemSettings(settings);
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value_json, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value_json = VALUES(setting_value_json), updated_at = VALUES(updated_at)`,
    ['global', JSON.stringify(normalized), Date.now()]
  );
  return normalized;
};

const getLocalSystemSettings = (store) => normalizeSystemSettings(store?.systemSettings || createDefaultSystemSettings());

const saveLocalSystemSettings = (store, settings) => {
  store.systemSettings = normalizeSystemSettings(settings);
  return store.systemSettings;
};

const getUserScopedSystemSettings = (systemSettings, user) => {
  const normalized = normalizeSystemSettings(systemSettings);
  return {
    ...normalized,
    analysisModel: normalizeUserAnalysisModel(user?.analysisModel) || normalized.analysisModel,
  };
};

const scrubDbStatesForDeletedAssets = async () => {
  const pool = await getMysqlPool();
  const assets = await listStoredAssets(pool);
  const [rows] = await pool.query('SELECT user_id, state_json FROM app_states');
  for (const row of rows) {
    const validAssetUrls = buildValidManagedAssetReferences(
      assets.filter((asset) => String(asset?.userId || '') === String(row.user_id || '')),
    );
    const parsedState = JSON.parse(row.state_json || '{}');
    const nextState = scrubUnavailableManagedAssetStateReferences(parsedState, validAssetUrls);
    await pool.query(
      'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(prepareStateForStorage(nextState)), Date.now(), row.user_id]
    );
  }
};

const scrubDbStateForUnavailableManagedAssets = async (state, userId) => {
  const pool = await getMysqlPool();
  const assets = await listStoredAssetsForUser(pool, userId);
  return prepareStateForStorage(scrubUnavailableManagedAssetStateReferences(state || createDefaultState(), buildValidManagedAssetReferences(assets)));
};

const scrubDbStateBeforeStorage = async (state, userId) => {
  return await scrubDbStateForUnavailableManagedAssets(state, userId);
};

const scrubDbJobPayloadBeforeSubmission = async (payload, userId) => {
  const pool = await getMysqlPool();
  const assets = await listStoredAssetsForUser(pool, userId);
  const scrubbed = scrubUnavailableManagedAssetUrls(payload || {}, buildValidManagedAssetReferences(assets));
  return scrubbed && typeof scrubbed === 'object' ? scrubbed : {};
};

const scrubLocalStateForUnavailableManagedAssets = async (state, userId) => {
  const assets = await listStoredAssetsForUser(null, userId);
  return prepareStateForStorage(
    scrubUnavailableManagedAssetStateReferences(state || createDefaultState(), buildValidManagedAssetReferences(assets))
  );
};

const scrubLocalStateBeforeStorage = async (state, userId) => {
  return await scrubLocalStateForUnavailableManagedAssets(state, userId);
};

const scrubLocalJobPayloadBeforeSubmission = async (payload, userId) => {
  const assets = await listStoredAssetsForUser(null, userId);
  const scrubbed = scrubUnavailableManagedAssetUrls(payload || {}, buildValidManagedAssetReferences(assets));
  return scrubbed && typeof scrubbed === 'object' ? scrubbed : {};
};

const createLibraryModelJobPayload = async ({
  payload,
  pool = null,
  store = null,
  user = null,
}) => {
  if (payload?.identitySource !== 'library') return payload || {};
  const historicalSnapshot = {
    identitySource: 'library',
    virtualModelId: String(payload.virtualModelId || '').trim(),
    virtualModelVersionId: String(payload.virtualModelVersionId || '').trim(),
    publishedAt: Number(payload.publishedAt),
    selectedAssetIds: Array.isArray(payload.selectedAssetIds)
      ? payload.selectedAssetIds.map((assetId) => String(assetId || '').trim())
      : [],
  };
  const allowHistoricalPublishedVersion = await findOwnedHistoricalVirtualModelSnapshot({
    pool,
    store,
    userId: user?.id,
    snapshot: historicalSnapshot,
  });
  const snapshot = await createVirtualModelGenerationJobSnapshot({
    pool,
    store,
    virtualModelId: String(payload.virtualModelId || '').trim(),
    virtualModelVersionId: String(payload.virtualModelVersionId || '').trim(),
    referenceAnalysis: payload.referenceAnalysis || null,
    allowHistoricalPublishedVersion,
    publishedAt: payload.publishedAt,
    selectedAssetIds: payload.selectedAssetIds,
  });
  const {
    assets,
    identityProfile,
    selectedIdentityAssetIds,
    allowHistoricalPublishedVersion: clientHistoricalFlag,
    publishedAt,
    selectedAssetIds,
    ...safePayload
  } = payload || {};
  void assets;
  void identityProfile;
  void selectedIdentityAssetIds;
  void clientHistoricalFlag;
  void publishedAt;
  void selectedAssetIds;
  return { ...safePayload, ...snapshot };
};

const insertModelReplaceLibraryMetadata = (prompt, metadataBlock) => {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedMetadata = String(metadataBlock || '').trim();
  if (!normalizedMetadata) return normalizedPrompt;
  const formatMarker = '\n\nF Format 格式';
  const formatIndex = normalizedPrompt.indexOf(formatMarker);
  if (formatIndex < 0) return `${normalizedPrompt}\n\n${normalizedMetadata}`.trim();
  return `${normalizedPrompt.slice(0, formatIndex)}\n\n${normalizedMetadata}${normalizedPrompt.slice(formatIndex)}`;
};

const injectLibraryModelAssetsForProvider = async (payload) => {
  if (payload?.identitySource !== 'library') return payload;
  const source = shouldUseMysql
    ? { pool: await getMysqlPool() }
    : { store: readLocalStore() };
  const assets = await resolveHistoricalVirtualModelSelectedAssets({
    ...source,
    virtualModelId: payload.virtualModelId,
    virtualModelVersionId: payload.virtualModelVersionId,
    selectedAssetIds: payload.selectedAssetIds,
  });
  const identityAssetSlotLabels = {
    front_close: '正面近景',
    left_45_close: '左侧45度近景',
    right_45_close: '右侧45度近景',
    profile_close: '侧面近景',
    three_quarter_half: '四分之三侧向半身',
    front_half: '正面半身',
    front_full: '正面全身',
    three_quarter_full: '四分之三全身',
  };
  const identityAnchorConstraint = assets.length > 0
    ? `【图A实际素材角度】\n${assets
      .map((asset, index) => `图A-${index + 1}（输入图${index + 1}）：${identityAssetSlotLabels[asset.slot] || asset.slot}。`)
      .join('\n')}`
    : '';
  const identityDescription = String(payload.identityDescription || '').trim();
  const identityDescriptionConstraint = identityDescription
    ? `身份档案补充（次于图A-1）：${JSON.stringify(identityDescription)}\n该档案只补充图A-1未清楚展示的身份特征；与图A-1冲突时一律以图A-1为准。`
    : '';
  const libraryMetadata = [
    identityAnchorConstraint,
    identityDescriptionConstraint,
  ].filter(Boolean).join('\n\n');
  return {
    ...payload,
    ...(libraryMetadata
      ? { prompt: insertModelReplaceLibraryMetadata(payload.prompt, libraryMetadata) }
      : {}),
    imageUrls: [...assets.map((asset) => asset.url),
      ...(Array.isArray(payload.imageUrls) ? payload.imageUrls : []),
    ],
  };
};

const executeProviderJobWithManagedAssetScrub = async (job, env, signal, options) => {
  const taskType = String(job?.taskType || '');
  if (taskType === 'upload_asset') {
    return await executeProviderJob(job, env, signal, options);
  }
  assertManagedAssetSubmissionUserContext({
    payload: job?.payload,
    userId: job?.userId,
  });
  const scrubbedPayload = shouldUseMysql
    ? await scrubDbJobPayloadBeforeSubmission(job?.payload, job?.userId)
    : await scrubLocalJobPayloadBeforeSubmission(job?.payload, job?.userId);
  assertManagedImageInputsPreserved({
    taskType,
    originalPayload: job?.payload,
    scrubbedPayload,
  });
  const assetPool = shouldUseMysql ? await getMysqlPool() : null;
  const inheritedAssetTransferDeps = options?.assetTransferDeps || {};
  const resolveJobManagedAssetReadUrl = async (value, readOptions = {}) => resolveManagedAssetReadUrl(value, {
    ...readOptions,
    pool: assetPool,
    userId: job?.userId,
    purpose: 'provider',
    env,
  });
  const assetTransferDeps = {
    ...inheritedAssetTransferDeps,
    resolveManagedAssetReadUrl: resolveJobManagedAssetReadUrl,
    resolveProviderSourceUrl: async (value, sourceOptions = {}) => resolveProviderGenerationMediaUrl(value, {
      env,
      signal: sourceOptions.signal || signal,
      uploadPath: 'mayo-storage/subtitle-removal',
      deps: {
        ...inheritedAssetTransferDeps,
        resolveManagedAssetReadUrl: resolveJobManagedAssetReadUrl,
        uploadAssetViaKieStream,
      },
    }),
    probeVideo: async (value, probeSignal) => {
      let probeTarget = value;
      const assetId = extractStoredAssetIdFromPublicUrl(value);
      if (assetId) {
        const asset = await getStoredAssetById(assetPool, assetId);
        if (
          asset
          && !asset.deletedAt
          && String(asset.storageStatus || 'active') === 'active'
          && String(asset.userId || '') === String(job?.userId || '')
          && getStoredAssetStorageProvider(asset) === 'internal'
        ) {
          probeTarget = resolveStoredAssetPath(asset) || value;
        }
      }
      return mediaTranscodeService.probe(probeTarget, 'video', probeSignal);
    },
  };
  const providerPayload = await injectLibraryModelAssetsForProvider(
    stripCreditReservationFromPayload(scrubbedPayload),
  );
  return await executeProviderJob(
    { ...job, payload: providerPayload },
    env,
    signal,
    { ...options, assetTransferDeps },
  );
};

const voiceoverAssetIdFromIdentity = ({ assetId = '', sourceUrl = '' } = {}) => {
  const explicit = String(assetId || '').trim();
  if (explicit) return explicit;
  const managedMatch = String(sourceUrl || '').trim().match(
    /^(?:managed|asset):\/\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/u,
  );
  return managedMatch?.[1] || extractStoredAssetIdFromPublicUrl(sourceUrl) || '';
};

const resolveOwnedVoiceoverAsset = async ({
  userId,
  assetId = '',
  sourceUrl = '',
  pool = null,
} = {}) => {
  const resolvedAssetId = voiceoverAssetIdFromIdentity({ assetId, sourceUrl });
  if (!resolvedAssetId) {
    const error = new Error('请选择当前账号拥有的托管视频');
    error.code = 'managed_asset_invalid';
    error.statusCode = 400;
    throw error;
  }
  const asset = await getStoredAssetById(pool, resolvedAssetId);
  if (
    !asset
    || asset.deletedAt
    || String(asset.storageStatus || 'active') !== 'active'
    || String(asset.userId || '') !== String(userId || '')
  ) {
    const error = new Error('托管素材不存在或不属于当前账号');
    error.code = 'managed_asset_forbidden';
    error.statusCode = 403;
    throw error;
  }
  return { ...asset, assetId: asset.id };
};

const materializeOwnedVoiceoverAsset = async ({
  asset,
  userId,
  destinationPath,
  pool = null,
  env = process.env,
  signal,
} = {}) => {
  const internalPath = getStoredAssetStorageProvider(asset) === 'internal'
    ? resolveStoredAssetPath(asset)
    : '';
  const maxBytes = getVoiceoverSourceMaxBytes(env);
  const declaredBytes = Number(asset?.fileSize || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    const error = new Error('源视频文件超过本地处理上限');
    error.code = 'voiceover_source_too_large';
    error.statusCode = 400;
    throw error;
  }
  await mkdirAsync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  let sizeBytes = declaredBytes;
  if (internalPath && existsSync(internalPath)) {
    sizeBytes = Number(statSync(internalPath).size || 0);
    if (sizeBytes > maxBytes) {
      const error = new Error('源视频文件超过本地处理上限');
      error.code = 'voiceover_source_too_large';
      error.statusCode = 400;
      throw error;
    }
    await copyFile(internalPath, destinationPath);
    sizeBytes = Number(statSync(destinationPath).size || 0);
    if (sizeBytes > maxBytes) {
      await rm(destinationPath, { force: true });
      const error = new Error('源视频文件超过本地处理上限');
      error.code = 'voiceover_source_too_large';
      error.statusCode = 400;
      throw error;
    }
  } else {
    const readUrl = await resolveManagedAssetReadUrl(asset.publicUrl, {
      pool,
      userId,
      purpose: 'provider',
      env,
    });
    const streamed = await streamVoiceoverAssetToFile({
      remoteUrl: readUrl,
      destinationPath,
      maxBytes,
      signal,
      timeoutMs: Number.parseInt(
        String(env.MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS || ''),
        10,
      ) || 120_000,
    });
    sizeBytes = streamed.sizeBytes;
  }
  return {
    ...asset,
    assetId: asset.id,
    url: asset.publicUrl,
    path: destinationPath,
    sizeBytes,
  };
};

const probeOwnedVoiceoverAsset = async ({
  asset,
  userId,
  pool = null,
  signal,
} = {}) => {
  const probeParent = path.join(dataDir, 'voiceover-submission-probes');
  await mkdirAsync(probeParent, { recursive: true, mode: 0o700 });
  return withVoiceoverProbeWorkspace({
    createWorkRoot: () => mkdtemp(path.join(probeParent, 'probe-')),
    cleanupWorkRoot: (probeRoot) => rm(probeRoot, { recursive: true, force: true }),
    operation: async (probeRoot) => {
      const localAsset = await materializeOwnedVoiceoverAsset({
        asset,
        userId,
        destinationPath: path.join(probeRoot, 'source.mp4'),
        pool,
        signal,
      });
      const metadata = await mediaTranscodeService.probe(localAsset.path, 'video', signal);
      return {
        durationMs: Number(metadata?.durationSeconds) * 1000,
        hasAudio: metadata?.hasAudio === true,
        width: Number(metadata?.width || 0),
        height: Number(metadata?.height || 0),
      };
    },
  });
};

const prepareVoiceoverSubmission = async ({
  body,
  user,
  pool = null,
  signal,
} = {}) => prepareVoiceoverSubmissionInput({
  body,
  userId: user?.id,
  signal,
  resolveOwnedAsset: (identity) => resolveOwnedVoiceoverAsset({
    ...identity,
    pool,
  }),
  probeVideo: (asset, probeSignal) => probeOwnedVoiceoverAsset({
    asset,
    userId: user?.id,
    pool,
    signal: probeSignal,
  }),
});

const createVoiceoverRunnerDependencies = async (job, env) => {
  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const childJobs = createVoiceoverChildJobLedger({
    mode: shouldUseMysql ? 'mysql' : 'local',
    ...(shouldUseMysql
      ? { pool }
      : {
          readLocalStore,
          mutateLocalStore,
        }),
    env,
  });
  const persistManagedFile = async ({
    filePath,
    userId,
    parentJobId,
    stage,
  }) => {
    const isFinal = stage === 'result_persisted';
    const originalName = isFinal
      ? 'voiceover-translated.mp4'
      : `${stage}${stage.includes('video') || stage === 'speech_analysis_media' ? '.mp4' : '.wav'}`;
    const persist = (lockedPool) => persistAssetFile({
      pool: lockedPool,
      publicBaseUrl: getPersistentAssetBaseUrl(),
      userId,
      module: 'video',
      assetType: isFinal ? 'result' : 'intermediate',
      originalName,
      mimeType: originalName.endsWith('.mp4') ? 'video/mp4' : 'audio/wav',
      sourcePath: filePath,
      provider: 'internal',
      jobId: parentJobId,
      ...(isFinal ? {} : { expiresAt: getVoiceoverIntermediateExpiresAt(env) }),
    });
    const assertActiveOwner = (owner) => {
      if (owner && owner.status === 'active') return;
      const error = new Error('账号已停用或不存在，未保存口播翻译结果');
      error.code = 'managed_asset_owner_unavailable';
      error.statusCode = 409;
      throw error;
    };
    const persisted = shouldUseMysql
      ? await withManagedAssetUserLock(userId, async (lockedPool) => {
          assertActiveOwner(await findAnyDbUserById(userId, lockedPool));
          return persist(lockedPool);
        })
      : await withLocalManagedAssetUserLock(userId, async () => {
          assertActiveOwner(findLocalUserById(userId));
          return persist(null);
        });
    return {
      assetId: persisted.id,
      url: persisted.publicUrl,
      path: filePath,
    };
  };
  const persistChildProviderOutput = async (child, output) => (
    persistJobOutputAssetsIfEnabled(child, output)
  );
  return {
    createWorkRoot: async ({ jobId }) => {
      const parent = path.join(dataDir, 'voiceover-jobs');
      await mkdirAsync(parent, { recursive: true, mode: 0o700 });
      return mkdtemp(path.join(parent, `${String(jobId || 'job').replace(/[^A-Za-z0-9_-]/gu, '_')}-`));
    },
    cleanupWorkRoot: (workRoot) => rm(workRoot, { recursive: true, force: true }),
    resolveOwnedAsset: async ({
      userId,
      assetId,
      sourceUrl,
      destinationPath,
      signal,
    }) => {
      const owned = await resolveOwnedVoiceoverAsset({
        userId,
        assetId,
        sourceUrl,
        pool,
      });
      return materializeOwnedVoiceoverAsset({
        asset: owned,
        userId,
        destinationPath,
        pool,
        env,
        signal,
      });
    },
    probeMedia: async ({ filePath, signal }) => {
      const probed = await mediaTranscodeService.probe(filePath, 'video', signal);
      return {
        ...probed,
        durationMs: Number(probed?.durationSeconds) * 1000,
        hasAudio: probed?.hasAudio === true,
      };
    },
    persistManagedFile,
    childJobs,
    extractAudio: ({ config: _config, ...options }) => extractVoiceoverAudio({
      ...options,
      deps: { env },
    }),
    separateVoice: (options) => separateVoiceover(options),
    buildVocalOnlyVideo: ({ config, ...options }) => buildVocalOnlyAnalysisVideo({
      ...options,
      config,
      deps: { env },
    }),
    analyzeSpeech: async ({ messages, signal }) => {
      const systemSettings = shouldUseMysql
        ? await getDbSystemSettings()
        : getLocalSystemSettings(readLocalStore());
      const model = resolveConfiguredVideoAnalysisModel(systemSettings);
      return executeProviderJobWithManagedAssetScrub({
        id: `${job.id}:analysis`,
        userId: job.userId,
        module: 'video',
        taskType: 'kie_chat',
        provider: 'kie',
        payload: { messages, model },
      }, env, signal);
    },
    runGolden: (options) => executeProviderJobWithManagedAssetScrub(
      options.job,
      env,
      options.signal,
      {
        onProviderTaskId: options.onProviderTaskId,
      },
    ),
    persistGoldenOutput: async ({ child, output }) => {
      const persisted = await persistChildProviderOutput(child, output);
      return {
        assetId: persisted?.result?.videoUrlAssetId,
        url: persisted?.result?.videoUrl,
        durationMs: persisted?.result?.durationMs,
      };
    },
    runTts: (options) => executeProviderJobWithManagedAssetScrub(
      options.job,
      env,
      options.signal,
      {
        onProviderTaskId: options.onProviderTaskId,
        voiceoverConfig: options.config,
      },
    ),
    persistTtsOutput: async ({ child, output }) => {
      const persisted = await persistChildProviderOutput(child, output);
      return persisted?.result || {};
    },
    alignAudio: ({ config, ...options }) => alignVoiceoverGroups({
      ...options,
      config,
      deps: { env },
    }),
    mixAudio: ({ config, ...options }) => mixVoiceoverResult({
      ...options,
      config,
      deps: { env },
    }),
    logger: {
      info: (entry) => console.info('[voiceover]', entry),
      error: (entry) => console.error('[voiceover]', entry),
    },
  };
};

const executeApplicationJob = async (job, env, signal, options = {}) => dispatchApplicationJob({
  job,
  executeVoiceover: async () => runVoiceoverTranslationJob({
    job,
    env,
    signal,
    onResultCheckpoint: options.onResultCheckpoint,
    deps: await createVoiceoverRunnerDependencies(job, env),
  }),
  executeDefault: () => executeProviderJobWithManagedAssetScrub(job, env, signal, options),
});

const prepareAgentModelImageUrl = (userId) => async (url) => {
  const resolved = await resolveProviderChatMediaUrlForModel(url, {
    env: process.env,
    deps: {
      uploadAssetViaKieStream,
      resolveManagedAssetReadUrl: async (value, readOptions = {}) => resolveManagedAssetReadUrl(value, {
        ...readOptions,
        pool: shouldUseMysql ? await getMysqlPool() : null,
        userId,
        purpose: 'provider',
        env: process.env,
      }),
    },
  });
  return String(resolved || url || '').trim();
};

const collectOneClickReferencePresetAssetUrls = (state) => {
  const urls = [];
  const presets = state?.oneClickMemory?.referencePresets || {};
  const unifiedPresets = Array.isArray(presets.presets) ? presets.presets : [];
  unifiedPresets.forEach((item) => {
    if (typeof item?.coverImageUrl === 'string' && item.coverImageUrl.trim()) {
      urls.push(item.coverImageUrl.trim());
    }
    if (Array.isArray(item?.referenceImageUrls)) {
      item.referenceImageUrls.forEach((url) => {
        if (typeof url === 'string' && url.trim()) urls.push(url.trim());
      });
    }
  });
  return urls;
};

const collectStateManagedAssetUrls = (state, bucket) => {
  collectTrackedAssetUrls(state, undefined, bucket);
  collectManagedAssetIdsInto(state, bucket);
  collectOneClickReferencePresetAssetUrls(state).forEach((url) => {
    if (isRemoteAssetUrl(url)) bucket.add(url);
  });
};

const collectManagedAssetIdsInto = (value, bucket) => {
  collectStoredAssetIdsFromValue(value).forEach((assetId) => bucket.add(String(assetId)));
};

const collectProtectedManagedAssetUrls = async ({ pool = null, store = null, ownerUserId = '' }) => {
  const protectedUrls = new Set();
  const normalizedOwnerUserId = String(ownerUserId || '').trim();
  const allAssets = normalizedOwnerUserId
    ? await listAllStoredAssetsForUser(pool, normalizedOwnerUserId)
    : await listAllStoredAssets(pool);
  const assetsById = new Map((allAssets || []).map((asset) => [String(asset?.id || ''), asset]));
  const assetsByJobId = new Map();
  (allAssets || []).forEach((asset) => {
    const jobId = String(asset?.jobId || '').trim();
    if (!jobId) return;
    if (!assetsByJobId.has(jobId)) assetsByJobId.set(jobId, []);
    assetsByJobId.get(jobId).push(asset);
  });
  const protectOwnedAsset = (asset, ownerUserId) => {
    if (!asset || String(asset?.userId || '') !== String(ownerUserId || '')) return;
    protectedUrls.add(String(asset.id));
    if (asset.publicUrl) protectedUrls.add(String(asset.publicUrl));
  };
  const addOwnedReferences = (value, ownerUserId) => {
    const normalizedOwnerId = String(ownerUserId || '');
    const referencedIds = new Set(collectStoredAssetIdsFromValue(value));
    const collectKnownIds = (current) => {
      if (typeof current === 'string' && assetsById.has(current)) referencedIds.add(current);
      else if (Array.isArray(current)) current.forEach(collectKnownIds);
      else if (current && typeof current === 'object') Object.values(current).forEach(collectKnownIds);
    };
    collectKnownIds(value);
    referencedIds.forEach((assetId) => {
      const asset = assetsById.get(String(assetId));
      protectOwnedAsset(asset, normalizedOwnerId);
    });
  };
  const addActiveRunReferences = (value, ownerUserId) => {
    getActiveManagedAssetRunIds(value).forEach((jobId) => {
      (assetsByJobId.get(jobId) || []).forEach((asset) => protectOwnedAsset(asset, ownerUserId));
    });
  };
  if (pool) {
    const ownerClause = normalizedOwnerUserId ? ' AND id = ?' : '';
    const resourceOwnerClause = normalizedOwnerUserId ? ' AND owner_user_id = ?' : '';
    const userDataClause = normalizedOwnerUserId ? ' WHERE user_id = ?' : '';
    const ownerValues = normalizedOwnerUserId ? [normalizedOwnerUserId] : [];
    const [userRows] = await pool.query(`SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''${ownerClause}`, ownerValues);
    const [agentRows] = await pool.query(`SELECT owner_user_id, icon_url FROM agents WHERE icon_url IS NOT NULL AND icon_url <> ''${resourceOwnerClause}`, ownerValues);
    const [stateRows] = await pool.query(`SELECT user_id, state_json FROM app_states${userDataClause}`, ownerValues);
    const [jobRows] = await pool.query(`SELECT id, user_id, status, provider_task_id, payload_json, result_json FROM internal_jobs${userDataClause}`, ownerValues);
    const [messageRows] = await pool.query(`SELECT user_id, content, attachments_json, metadata_json FROM chat_messages${userDataClause}`, ownerValues);
    userRows.forEach((row) => addOwnedReferences(row.avatar_url, row.id));
    agentRows.forEach((row) => addOwnedReferences(row.icon_url, row.owner_user_id));
    stateRows.forEach((row) => {
      try {
        const state = typeof row.state_json === 'string' ? JSON.parse(row.state_json || '{}') : row.state_json;
        const stateRefs = new Set();
        collectStateManagedAssetUrls(state, stateRefs);
        addOwnedReferences(Array.from(stateRefs), row.user_id);
      } catch {
        // Ignore malformed state rows during cleanup; invalid rows are handled by normal state loading.
      }
    });
    jobRows.forEach((row) => {
      addOwnedReferences(parseJsonField(row.payload_json, row.payload_json), row.user_id);
      addOwnedReferences(parseJsonField(row.result_json, row.result_json), row.user_id);
      addActiveRunReferences({ id: row.id, status: row.status, providerTaskId: row.provider_task_id }, row.user_id);
    });
    messageRows.forEach((row) => {
      const metadata = parseJsonField(row.metadata_json, row.metadata_json);
      addOwnedReferences(row.content, row.user_id);
      addOwnedReferences(parseJsonField(row.attachments_json, row.attachments_json), row.user_id);
      addOwnedReferences(metadata, row.user_id);
      addActiveRunReferences(metadata, row.user_id);
    });
    return protectedUrls;
  }

  const matchesOwner = (value) => !normalizedOwnerUserId || String(value || '') === normalizedOwnerUserId;
  const users = (Array.isArray(store?.users) ? store.users : []).filter((item) => matchesOwner(item?.id));
  const agents = (Array.isArray(store?.agents) ? store.agents : []).filter((item) => matchesOwner(item?.ownerUserId));
  users.forEach((item) => addOwnedReferences(item.avatarUrl, item.id));
  agents.forEach((item) => addOwnedReferences(item.iconUrl, item.ownerUserId));
  Object.entries(store?.appStates || {}).forEach(([userId, state]) => {
    if (!matchesOwner(userId)) return;
    const stateRefs = new Set();
    collectStateManagedAssetUrls(state, stateRefs);
    addOwnedReferences(Array.from(stateRefs), userId);
  });
  (store?.jobs || []).forEach((job) => {
    if (!matchesOwner(job?.userId)) return;
    addOwnedReferences(job?.payload, job?.userId);
    addOwnedReferences(job?.result, job?.userId);
    addActiveRunReferences(job, job?.userId);
  });
  (store?.chatMessages || []).forEach((message) => {
    if (!matchesOwner(message?.userId)) return;
    addOwnedReferences(message?.content, message?.userId);
    addOwnedReferences(message?.attachments, message?.userId);
    addOwnedReferences(message?.metadata, message?.userId);
    addActiveRunReferences(message?.metadata, message?.userId);
  });
  return protectedUrls;
};

const scrubDbProtectedManagedAssetRefs = async () => {
  const pool = await getMysqlPool();
  const assets = await listStoredAssets(pool);
  const refsByUser = new Map();
  const refsForUser = (userId) => {
    const key = String(userId || '');
    if (!refsByUser.has(key)) {
      refsByUser.set(key, buildValidManagedAssetReferences(
        assets.filter((asset) => String(asset?.userId || '') === key),
      ));
    }
    return refsByUser.get(key);
  };
  const [userRows] = await pool.query("SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''");
  for (const row of userRows || []) {
    if (isManagedAssetUrl(row.avatar_url) && !isAvailableManagedAssetUrl(row.avatar_url, refsForUser(row.id))) {
      await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [row.id]);
    }
  }
  const [agentRows] = await pool.query("SELECT id, owner_user_id, icon_url FROM agents WHERE icon_url IS NOT NULL AND icon_url <> ''");
  for (const row of agentRows || []) {
    if (isManagedAssetUrl(row.icon_url) && !isAvailableManagedAssetUrl(row.icon_url, refsForUser(row.owner_user_id))) {
      await pool.query('UPDATE agents SET icon_url = NULL WHERE id = ?', [row.id]);
    }
  }
};

const scrubLocalProtectedManagedAssetRefs = async (store) => {
  const assets = await listStoredAssets(null);
  const refsForUser = (userId) => buildValidManagedAssetReferences(
    assets.filter((asset) => String(asset?.userId || '') === String(userId || '')),
  );
  (store.users || []).forEach((user) => {
    if (isManagedAssetUrl(user.avatarUrl) && !isAvailableManagedAssetUrl(user.avatarUrl, refsForUser(user.id))) {
      user.avatarUrl = '';
    }
  });
  (store.agents || []).forEach((agent) => {
    if (isManagedAssetUrl(agent.iconUrl) && !isAvailableManagedAssetUrl(agent.iconUrl, refsForUser(agent.ownerUserId))) {
      agent.iconUrl = '';
    }
  });
  writeLocalStore(store);
};

const persistUploadedAssetIfEnabled = async ({ req, user, moduleName, assetType = 'source', fileName, mimeType, fileBuffer, width = 0, height = 0 }) => {
  const publicBaseUrl = getPersistentAssetBaseUrl(req);
  const normalizedAssetType = String(assetType || 'source').trim().toLowerCase();
  const managedImage = ['source', 'reference', 'chat'].includes(normalizedAssetType)
    ? resolveManagedImageUpload({ fileBuffer, mimeType, env: process.env })
    : { isImage: false, mimeType: String(mimeType || 'application/octet-stream').trim().toLowerCase() };
  const isImageUpload = managedImage.isImage;
  if (!isImageUpload && !isExternallyReachableBaseUrl(publicBaseUrl)) {
    return null;
  }
  const persist = (pool) => persistUploadedAssetBuffer({
    pool,
    publicBaseUrl,
    userId: user.id,
    module: moduleName,
    assetType: normalizedAssetType,
    originalName: fileName,
    mimeType: managedImage.mimeType,
    fileBuffer,
    width,
    height,
    env: process.env,
  });
  if (!shouldUseMysql) {
    return withLocalManagedAssetUserLock(user.id, async () => {
      const owner = findLocalUserById(user.id);
      if (!owner || owner.status !== 'active') {
        const error = new Error('账号已停用或不存在，未上传素材');
        error.code = 'managed_asset_owner_unavailable';
        error.statusCode = 409;
        throw error;
      }
      return persist(null);
    });
  }
  return withManagedAssetUserLock(user.id, async (pool) => {
    const owner = await findAnyDbUserById(user.id);
    if (!owner || owner.status !== 'active') {
      const error = new Error('账号已停用或不存在，未上传素材');
      error.code = 'managed_asset_owner_unavailable';
      error.statusCode = 409;
      throw error;
    }
    return persist(pool);
  });
};

const buildTransformedImageOutputName = (fallbackName = 'result.png') => {
  const name = String(fallbackName || 'result.png').trim() || 'result.png';
  const ext = path.extname(name);
  return ext ? `${name.slice(0, -ext.length)}.jpg` : `${name}.jpg`;
};

const persistJobOutputAssetsIfEnabled = async (job, output, lockedPool = null, localLockHeld = false) => {
  const publicBaseUrl = getPersistentAssetBaseUrl();
  if (!output?.result || !job?.userId) {
    return output;
  }

  if (shouldUseMysql && !lockedPool) {
    return withManagedAssetUserLock(job.userId, async (pool) => {
      const owner = await findAnyDbUserById(job.userId);
      if (!owner || owner.status !== 'active') {
        const error = new Error('账号已停用或不存在，未保存任务结果');
        error.code = 'managed_asset_owner_unavailable';
        error.statusCode = 409;
        throw error;
      }
      return persistJobOutputAssetsIfEnabled(job, output, pool);
    });
  }
  if (!shouldUseMysql && !localLockHeld) {
    return withLocalManagedAssetUserLock(job.userId, async () => {
      const owner = findLocalUserById(job.userId);
      if (!owner || owner.status !== 'active') {
        const error = new Error('账号已停用或不存在，未保存任务结果');
        error.code = 'managed_asset_owner_unavailable';
        error.statusCode = 409;
        throw error;
      }
      return persistJobOutputAssetsIfEnabled(job, output, null, true);
    });
  }

  const pool = lockedPool;
  let result = { ...(output.result || {}) };
  result = prepareKieTtsOutputForPersistence({ job, result, publicBaseUrl, isManagedAssetUrl });
  const imageTransform = buildImageOutputTransformFromJob(job);
  const hasInlineImageResult = /^data:image\//i.test(String(result.imageUrl || '').trim());
  if (hasInlineImageResult && !publicBaseUrl) {
    const error = new Error('图片已生成，但当前服务无法安全保存内联图片结果');
    error.code = 'provider_bad_response';
    error.providerMessage = error.message;
    error.providerStage = 'provider_response';
    error.providerStatus = 'failed';
    throw error;
  }
  if (hasInlineImageResult) {
    let inlineTransformed = null;
    try {
      result = await persistInlineImageResult({
        result,
        transformImage: imageTransform
          ? async ({ fileBuffer }) => {
              inlineTransformed = await transformImageOutputBuffer(fileBuffer, imageTransform);
              return {
                fileBuffer: inlineTransformed.buffer,
                mimeType: inlineTransformed.mimeType,
                originalName: buildTransformedImageOutputName(`${job.taskType || 'result'}.png`),
                width: inlineTransformed.width,
                height: inlineTransformed.height,
                ...(inlineTransformed.transformSkippedReason
                  ? { assetType: 'result_quarantine' }
                  : {}),
                ...(inlineTransformed.transformSkippedReason
                  ? {
                      outputTransform: {
                        transformSkippedReason: inlineTransformed.transformSkippedReason,
                        sourceWidth: inlineTransformed.sourceWidth,
                        sourceHeight: inlineTransformed.sourceHeight,
                        targetWidth: inlineTransformed.targetWidth,
                        targetHeight: inlineTransformed.targetHeight,
                      },
                    }
                  : {}),
              };
            }
          : undefined,
        persistOptions: {
          pool,
          publicBaseUrl,
          userId: job.userId,
          module: job.module,
          assetType: 'result',
          originalName: `${job.taskType || 'result'}.png`,
          provider: job.provider,
          jobId: job.id,
        },
      });
    } catch (quarantineError) {
      if (inlineTransformed?.transformSkippedReason === 'aspect_ratio_mismatch') {
        throw createProviderCompletedImageOutputRejectedError({
          job,
          output,
          result,
          transformed: inlineTransformed,
          quarantineError,
        });
      }
      throw quarantineError;
    }
    if (inlineTransformed?.transformSkippedReason === 'aspect_ratio_mismatch') {
      throw createProviderCompletedImageOutputRejectedError({
        job,
        output,
        result,
        persisted: {
          id: result.imageUrlAssetId,
          publicUrl: result.imageUrl,
        },
        transformed: inlineTransformed,
      });
    }
  }
  if (!publicBaseUrl) {
    return { ...output, result };
  }
  const persistRemoteField = async (fieldName, assetType, fallbackName) => {
    const sourceUrl = result[fieldName];
    if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl) || isManagedAssetUrl(sourceUrl)) {
      return;
    }

    let persisted;
    if (fieldName === 'imageUrl' && imageTransform) {
      const { fileBuffer } = await fetchRemoteAssetBufferWithRetry(sourceUrl);
      const transformed = await transformImageOutputBuffer(fileBuffer, imageTransform);
      try {
        persisted = await persistAssetBuffer({
          pool,
          publicBaseUrl,
          userId: job.userId,
          module: job.module,
          assetType: transformed.transformSkippedReason ? 'result_quarantine' : assetType,
          originalName: buildTransformedImageOutputName(fallbackName),
          mimeType: transformed.mimeType,
          fileBuffer: transformed.buffer,
          width: transformed.width || imageTransform.width || 0,
          height: transformed.height || imageTransform.height || 0,
          provider: job.provider,
          providerSourceUrl: sourceUrl,
          jobId: job.id,
        });
      } catch (quarantineError) {
        if (transformed.transformSkippedReason === 'aspect_ratio_mismatch') {
          throw createProviderCompletedImageOutputRejectedError({
            job,
            output,
            result,
            sourceUrl,
            transformed,
            quarantineError,
          });
        }
        throw quarantineError;
      }
      if (transformed.transformSkippedReason === 'aspect_ratio_mismatch') {
        throw createProviderCompletedImageOutputRejectedError({
          job,
          output,
          result,
          sourceUrl,
          persisted,
          transformed,
        });
      }
    } else {
      persisted = await persistRemoteAsset({
        pool,
        publicBaseUrl,
        userId: job.userId,
        module: job.module,
        assetType,
        remoteUrl: sourceUrl,
        originalName: fallbackName,
        provider: job.provider,
        jobId: job.id,
      });
    }
    result[fieldName] = persisted.publicUrl;
    result[`${fieldName}AssetId`] = persisted.id;
    if (fieldName !== 'audioUrl') {
      result[`${fieldName}RemoteUrl`] = sourceUrl;
    }
  };

  const persistRemoteArrayField = async (fieldName, assetType, fallbackNameBuilder) => {
    const sourceUrls = Array.isArray(output[fieldName]) ? output[fieldName] : [];
    if (sourceUrls.length === 0) return;
    const persistedUrls = [];
    for (let index = 0; index < sourceUrls.length; index += 1) {
      const sourceUrl = String(sourceUrls[index] || '').trim();
      if (!/^https?:\/\//i.test(sourceUrl)) continue;
      if (isManagedAssetUrl(sourceUrl)) {
        persistedUrls.push(sourceUrl);
        continue;
      }
      const persisted = await persistRemoteAsset({
        pool,
        publicBaseUrl,
        userId: job.userId,
        module: job.module,
        assetType,
        remoteUrl: sourceUrl,
        originalName: fallbackNameBuilder(index),
        provider: job.provider,
        jobId: job.id,
      });
      persistedUrls.push(persisted.publicUrl);
    }
    output[fieldName] = persistedUrls;
  };

  await persistRemoteField('imageUrl', 'result', `${job.taskType || 'result'}.png`);
  result = await persistManagedRemoteJobOutput({
    job,
    result,
    publicBaseUrl,
    persistRemoteAsset: (options) => persistRemoteAsset({ pool, ...options }),
    isManagedAssetUrl,
    getVoiceoverIntermediateExpiresAt,
  });
  await persistRemoteArrayField('imageResultUrls', 'result', (index) => `${job.taskType || 'result'}_${index + 1}.png`);
  await persistRemoteArrayField('resultUrls', 'result', (index) => `${job.taskType || 'result'}_${index + 1}.png`);

  return {
    ...output,
    result,
  };
};

const persistRuntimeRemoteAssetIfEnabled = async ({ userId, moduleName, assetType = 'result', remoteUrl, originalName = 'result.png', provider = 'kie', jobId = '', localLockHeld = false }) => {
  const publicBaseUrl = getPersistentAssetBaseUrl();
  const normalizedUrl = String(remoteUrl || '').trim();
  if (!isExternallyReachableBaseUrl(publicBaseUrl) || !userId || !/^https?:\/\//i.test(normalizedUrl) || isManagedAssetUrl(normalizedUrl)) {
    return normalizedUrl;
  }
  const persist = async (pool) => {
    try {
      const persisted = await persistRemoteAsset({
        pool,
        publicBaseUrl,
        userId,
        module: moduleName,
        assetType,
        remoteUrl: normalizedUrl,
        originalName,
        provider,
        jobId,
      });
      return persisted.publicUrl;
    } catch (error) {
      console.warn('[asset-store] runtime remote asset persistence failed', {
        moduleName,
        assetType,
        provider,
        jobId,
        message: error?.message || String(error || ''),
      });
      return normalizedUrl;
    }
  };
  if (!shouldUseMysql) {
    if (localLockHeld) {
      const owner = findLocalUserById(userId);
      return owner?.status === 'active' ? persist(null) : normalizedUrl;
    }
    return withLocalManagedAssetUserLock(userId, async () => {
      const owner = findLocalUserById(userId);
      if (!owner || owner.status !== 'active') return normalizedUrl;
      return persist(null);
    });
  }
  return withManagedAssetUserLock(userId, async (pool) => {
    const owner = await findAnyDbUserById(userId);
    if (!owner || owner.status !== 'active') return normalizedUrl;
    return persist(pool);
  });
};

const buildStoredAssetCacheTag = (assetId, fileSize, mtimeMs) => (
  `W/"stored-asset-${assetId}-${fileSize}-${Math.floor(mtimeMs)}"`
);

const isConditionalAssetCacheHit = (req, assetCacheTag, assetLastModified) => {
  const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(',').map((item) => item.trim());
    if (candidates.includes('*') || candidates.includes(assetCacheTag)) {
      return true;
    }
  }

  const ifModifiedSince = String(req.headers['if-modified-since'] || '').trim();
  if (!ifModifiedSince) return false;
  const requestedTime = Date.parse(ifModifiedSince);
  const assetTime = Date.parse(assetLastModified);
  return Number.isFinite(requestedTime) && Number.isFinite(assetTime) && requestedTime >= assetTime;
};

const buildStoredAssetXAccelRedirectPath = (storageKey) => {
  const segments = String(storageKey || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    return '';
  }
  return `${ASSET_X_ACCEL_PREFIX}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
};

const shouldUseStoredAssetXAccel = (req) => (
  process.env.MEIAO_ASSET_X_ACCEL === '1'
  && Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip'])
);

const serveStoredAsset = async (req, res, assetId, options = {}) => {
  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const asset = await getStoredAssetById(pool, assetId);
  if (!asset || asset.deletedAt || String(asset.storageStatus || 'active') !== 'active') {
    json(res, 404, { message: '资源不存在或已删除。' });
    return;
  }

  if (getStoredAssetStorageProvider(asset) === 'tencent_cos') {
    const accessKeyValid = verifyManagedAssetAccessKey(options.accessKey, {
      assetId: asset.id,
      userId: asset.userId,
    }, process.env);
    const requestUserId = accessKeyValid
      ? ''
      : String(options.userId || await options.resolveRequestUserId?.() || '').trim();
    if (!accessKeyValid && (!requestUserId || requestUserId !== String(asset.userId || ''))) {
      json(res, 403, { message: '没有权限读取该图片素材。' });
      return;
    }
    const signedReadUrl = await resolveManagedAssetReadUrl(asset.publicUrl || buildAssetPublicPath(asset.id, asset.originalName), {
      pool,
      purpose: 'browser',
      userId: asset.userId,
      getAsset: async () => asset,
      env: process.env,
    });
    scheduleStoredAssetAccessTouch(pool, asset.id, Date.now());
    res.writeHead(302, {
      'Location': signedReadUrl,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(res.__corsHeaders || {}),
    });
    res.end();
    return;
  }
  const fullPath = resolveStoredAssetPath(asset);
  if (!fullPath || !existsSync(fullPath)) {
    await markStoredAssetDeleted(pool, asset.id, Date.now());
    json(res, 404, { message: '资源文件不存在。' });
    return;
  }

  const stats = statSync(fullPath);
  const fileSize = stats.size;
  const contentType = asset.mimeType || 'application/octet-stream';
  const assetLastModified = new Date(stats.mtimeMs).toUTCString();
  const assetCacheTag = buildStoredAssetCacheTag(asset.id, fileSize, stats.mtimeMs);
  scheduleStoredAssetAccessTouch(pool, asset.id, Date.now());
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=604800, immutable',
    'ETag': assetCacheTag,
    'Last-Modified': assetLastModified,
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    ...(res.__corsHeaders || {}),
  };
  const rangeHeader = String(req.headers.range || '').trim();

  if (!rangeHeader && isConditionalAssetCacheHit(req, assetCacheTag, assetLastModified)) {
    res.writeHead(304, baseHeaders);
    res.end();
    return;
  }

  const xAccelRedirectPath = shouldUseStoredAssetXAccel(req)
    ? buildStoredAssetXAccelRedirectPath(asset.storageKey)
    : '';
  if (xAccelRedirectPath) {
    res.writeHead(200, {
      ...baseHeaders,
      'X-Accel-Redirect': xAccelRedirectPath,
    });
    res.end();
    return;
  }

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    let start = rangeMatch?.[1] ? Number(rangeMatch[1]) : NaN;
    let end = rangeMatch?.[2] ? Number(rangeMatch[2]) : NaN;

    if (!rangeMatch || fileSize <= 0 || (Number.isNaN(start) && Number.isNaN(end))) {
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${fileSize}`,
      });
      res.end();
      return;
    }

    if (Number.isNaN(start)) {
      const suffixLength = Math.max(0, end);
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
    } else {
      end = Number.isNaN(end) ? fileSize - 1 : Math.min(end, fileSize - 1);
    }

    if (start < 0 || start >= fileSize || end < start) {
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${fileSize}`,
      });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(fullPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': fileSize,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(fullPath).pipe(res);
};

const deleteStoredAssetForUserUnlocked = async ({ user, fileUrl }) => {
  const assetId = extractStoredAssetIdFromPublicUrl(fileUrl);
  if (!assetId) {
    throw new Error('无效的素材地址');
  }

  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const asset = await getStoredAssetById(pool, assetId);
  if (!asset || asset.deletedAt) {
    return { deleted: false, assetId };
  }
  if (asset.userId !== user.id && user.role !== 'admin') {
    throw new Error('没有权限删除该素材');
  }

  const protectedAssetRefs = await collectProtectedManagedAssetUrls({
    pool,
    store: shouldUseMysql ? null : readLocalStore(),
  });
  const deletion = await requestStoredAssetDeletion({
    pool,
    asset,
    reason: 'explicit_asset_delete',
    isReferenced: protectedAssetRefs.has(asset.publicUrl) || protectedAssetRefs.has(asset.id),
    env: process.env,
  });
  return { deleted: deletion.queued, protected: deletion.protected, assetId };
};

const deleteStoredAssetForUser = async ({ user, fileUrl }) => {
  if (shouldUseMysql) {
    const assetId = extractStoredAssetIdFromPublicUrl(fileUrl);
    if (!assetId) throw new Error('无效的素材地址');
    const asset = await getStoredAssetById(await getMysqlPool(), assetId);
    if (!asset || asset.deletedAt) return { deleted: false, assetId };
    if (asset.userId !== user.id && user.role !== 'admin') {
      throw new Error('没有权限删除该素材');
    }
    return withManagedAssetUserLock(asset.userId, () => deleteStoredAssetForUserUnlocked({ user, fileUrl }));
  }
  return deleteStoredAssetForUserUnlocked({ user, fileUrl });
};

const collectStoredAssetIdsFromChatMessages = (messages = []) => {
  const ids = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const values = [
      message?.content,
      message?.attachments,
      message?.metadata,
      parseJsonField(message?.attachments_json, null),
      parseJsonField(message?.metadata_json, null),
    ];
    for (const value of values) {
      collectStoredAssetIdsFromValue(value).forEach((id) => ids.add(id));
    }
  }
  return Array.from(ids);
};

const collectStoredAssetIdsFromJob = (job) => (
  collectStoredAssetIdsFromValue([job?.payload, job?.result])
);

const queueStoredAssetsAfterReferenceRemoval = async ({
  pool = null,
  assetIds,
  reason,
  referenceStore = null,
  ownerUserId = '',
  allowAnyOwner = false,
}) => {
  const uniqueIds = Array.from(new Set(Array.isArray(assetIds) ? assetIds.filter(Boolean) : []));
  if (!uniqueIds.length) return { deletedAssetIds: [] };
  const protectedAssetRefs = await collectProtectedManagedAssetUrls({ pool, store: referenceStore });
  const deletedAssetIds = [];
  for (const assetId of uniqueIds) {
    const asset = await getStoredAssetById(pool, assetId);
    if (!asset || asset.deletedAt) continue;
    if (!allowAnyOwner && String(asset.userId || '') !== String(ownerUserId || '')) continue;
    const deletion = await requestStoredAssetDeletion({
      pool,
      asset,
      reason,
      isReferenced: protectedAssetRefs.has(asset.publicUrl) || protectedAssetRefs.has(asset.id),
      env: process.env,
    });
    if (deletion.queued) deletedAssetIds.push(asset.id);
  }
  return { deletedAssetIds };
};

const deleteStoredAssetsByIdsForUser = async ({
  user,
  assetIds,
  reason = 'bulk_owner_delete',
  referenceStore = null,
  poolOverride = undefined,
}) => {
  const pool = poolOverride !== undefined
    ? poolOverride
    : shouldUseMysql ? await getMysqlPool() : null;
  return queueStoredAssetsAfterReferenceRemoval({
    pool,
    assetIds,
    reason,
    referenceStore: shouldUseMysql ? null : referenceStore || readLocalStore(),
    ownerUserId: user.id,
    allowAnyOwner: user.role === 'admin',
  });
};

const queueRemovedStateAssetsForCleanup = async ({
  user,
  previousState,
  nextState,
  referenceStore = null,
  poolOverride = undefined,
}) => {
  const previousIds = new Set(collectStoredAssetIdsFromValue(previousState));
  collectStoredAssetIdsFromValue(nextState).forEach((assetId) => previousIds.delete(assetId));
  if (previousIds.size === 0) return { deletedAssetIds: [] };
  return deleteStoredAssetsByIdsForUser({
    user,
    assetIds: Array.from(previousIds),
    reason: 'state_reference_removed',
    referenceStore,
    poolOverride,
  });
};

const cleanupExpiredStoredAssets = async () => {
  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const allAssets = await listStoredAssets(pool);
  const protectedAssetUrls = await collectProtectedManagedAssetUrls({ pool, store: shouldUseMysql ? null : readLocalStore() });
  const referenceTime = Date.now();
  const assetsWithReferences = allAssets.map((asset) => ({
    ...asset,
    isReferenced: protectedAssetUrls.has(asset.publicUrl) || protectedAssetUrls.has(asset.id),
  }));
  const expiredAssets = selectExpiredAssetsForCleanup(assetsWithReferences, referenceTime)
    .map((asset) => ({ ...asset, cleanupReason: 'retention_expired' }));
  const crashOrphans = selectAbandonedPermanentAgentResultAssets(
    assetsWithReferences,
    referenceTime,
    getStoredAssetDeleteGraceMs(process.env),
  ).map((asset) => ({ ...asset, cleanupReason: 'unreferenced_agent_result_reconcile' }));
  const cleanupAssets = Array.from(new Map(
    [...expiredAssets, ...crashOrphans].map((asset) => [asset.id, asset]),
  ).values());
  if (cleanupAssets.length === 0) return;

  for (const asset of cleanupAssets) {
    if (shouldUseMysql) {
      await withManagedAssetUserLock(asset.userId, async (lockedPool) => {
        const freshAsset = await getStoredAssetById(lockedPool, asset.id);
        if (!freshAsset || freshAsset.deletedAt) return;
        const freshProtectedRefs = await collectProtectedManagedAssetUrls({
          pool: lockedPool,
          ownerUserId: freshAsset.userId,
        });
        await requestStoredAssetDeletion({
          pool: lockedPool,
          asset: freshAsset,
          reason: asset.cleanupReason,
          isReferenced: freshProtectedRefs.has(freshAsset.publicUrl) || freshProtectedRefs.has(freshAsset.id),
          env: process.env,
        });
      });
    } else {
      await requestStoredAssetDeletion({
        pool,
        asset,
        reason: asset.cleanupReason,
        isReferenced: false,
        env: process.env,
      });
    }
  }

  if (shouldUseMysql) {
    await scrubDbStatesForDeletedAssets();
    await scrubDbProtectedManagedAssetRefs();
  } else {
    await scrubLocalStatesForDeletedAssets();
    await scrubLocalProtectedManagedAssetRefs(readLocalStore());
  }
};

const queueUserAssetsForCleanup = async (userId) => {
  const assets = await listAllStoredAssets(null);
  let queued = 0;
  for (const asset of assets) {
    if (String(asset?.userId || '') !== String(userId || '')) continue;
    const result = await requestStoredAssetDeletion({
      pool: null,
      asset,
      reason: 'account_deleted',
      isReferenced: false,
      env: process.env,
    });
    if (result.queued) queued += 1;
  }
  return queued;
};

const runManagedAssetCleanupCycle = async ({ mutationLockHeld = false } = {}) => {
  if (!shouldUseMysql && !mutationLockHeld) {
    return withLocalStoreMutationLock(() => runManagedAssetCleanupCycle({ mutationLockHeld: true }));
  }
  if (assetCleanupRunning) return { skipped: true };
  assetCleanupRunning = true;
  try {
    await cleanupExpiredStoredAssets();
    const pool = shouldUseMysql ? await getMysqlPool() : null;
    const verifyActiveCos = Date.now() - lastManagedCosReconciliationAt >= ASSET_COS_RECONCILE_INTERVAL_MS;
    const reconciliation = await reconcileManagedAssetStorage({
      pool,
      env: process.env,
      verifyActiveCos,
    });
    if (verifyActiveCos && reconciliation.activeCosHeadFailed === 0) {
      lastManagedCosReconciliationAt = Date.now();
    }
    const cleanup = await processAssetCleanupBatch({
      pool,
      limit: ASSET_CLEANUP_BATCH_SIZE,
      env: process.env,
      storeOptions: { inProgressLeaseMs: ASSET_CLEANUP_LEASE_MS },
      isProtected: async (task) => {
        if (!task?.assetId) return false;
        const asset = await getStoredAssetById(pool, task.assetId);
        if (!asset || !asset.userId) return false;
        const protectedAssetRefs = await collectProtectedManagedAssetUrls({
          pool,
          store: shouldUseMysql ? null : readLocalStore(),
          ownerUserId: asset.userId,
        });
        return protectedAssetRefs.has(String(task.assetId));
      },
    });
    await pruneAssetCleanupTasks(pool, {
      retentionMs: process.env.MEIAO_ASSET_CLEANUP_AUDIT_RETENTION_MS,
    });
    const queueSummary = await summarizeAssetCleanupStore(pool);
    managedAssetCleanup = {
      ...queueSummary,
      uploadFailed: reconciliation.uploadFailed,
      deletePending: reconciliation.deletePending,
      uploading: reconciliation.uploading,
      snapshotMissing: reconciliation.snapshotMissing,
      activeCosChecked: reconciliation.activeCosChecked,
      activeCosMissing: reconciliation.activeCosMissing,
      activeCosHeadFailed: reconciliation.activeCosHeadFailed,
      alerting: queueSummary.backlog >= ASSET_CLEANUP_ALERT_BACKLOG
        || queueSummary.oldestPendingAgeMs >= ASSET_CLEANUP_ALERT_OLDEST_MS
        || queueSummary.manualReview > 0
        || reconciliation.snapshotMissing > 0
        || reconciliation.activeCosMissing > 0
        || reconciliation.activeCosHeadFailed > 0,
      lastCycleAt: Date.now(),
    };
    if (reconciliation.enqueued > 0 || cleanup.claimed > 0 || managedAssetCleanup.alerting) {
      console.info('managed asset cleanup cycle', {
        reconciliation,
        cleanup,
        queue: managedAssetCleanup,
      });
    }
    return { reconciliation, cleanup };
  } finally {
    assetCleanupRunning = false;
  }
};

const runManagedImageUploadProbeCycle = async () => {
  if (managedImageProbeRunning) return { skipped: true };
  const currentHealth = getManagedImageUploadHealth({ env: process.env });
  if (currentHealth.mode !== 'cos' || !currentHealth.configured) return { skipped: true };
  managedImageProbeRunning = true;
  try {
    const result = await runManagedImageCosProbe({ env: process.env, writeLine: () => {} });
    writeManagedImageProbeStatus({ env: process.env, ok: true });
    return result;
  } catch (error) {
    const failureCode = error?.code || 'probe_failed';
    try {
      writeManagedImageProbeStatus({ env: process.env, ok: false, errorCode: failureCode });
    } catch (statusError) {
      console.error('managed image COS readiness status write failed', {
        code: String(statusError?.code || 'status_write_failed').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80),
      });
    }
    console.error('managed image COS readiness probe failed', {
      code: String(failureCode).replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80),
    });
    return { ok: false };
  } finally {
    managedImageProbeRunning = false;
  }
};

const createDbSession = async (userId) => {
  const pool = await getMysqlPool();
  const token = randomBytes(24).toString('hex');
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [token, userId, Date.now() + SESSION_TTL_MS, Date.now()]
  );
  return token;
};

const deleteDbSession = async (token) => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
};

const purgeExpiredDbSessions = async () => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
};

const getDbSessionUser = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  await purgeExpiredDbSessions();
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT u.*
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.status = ?
     LIMIT 1`,
    [token, Date.now(), 'active']
  );

  return rows[0] ? mapDbUser(rows[0]) : null;
};

const createDbUser = async ({ username, password, role = 'staff', displayName = '', jobConcurrency = DEFAULT_JOB_CONCURRENCY, featurePermissions = DEFAULT_FEATURE_PERMISSIONS, creditLimitMode = CREDIT_LIMIT_MODES.UNLIMITED, creditBalance = 0 }) => {
  const pool = await getMysqlPool();
  const newUser = createUser({ username, password, role, displayName, jobConcurrency, featurePermissions, creditLimitMode, creditBalance });
  await pool.query(
    `INSERT INTO users (
      id, username, display_name, avatar_url, avatar_preset, role, status,
      job_concurrency, feature_permissions_json, analysis_model,
      credit_limit_mode, credit_balance, credit_reserved, credit_consumed,
      password_hash, salt, created_at, last_login_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newUser.id,
      newUser.username,
      newUser.displayName,
      newUser.avatarUrl || null,
      newUser.avatarPreset || 'aurora',
      newUser.role,
      newUser.status,
      newUser.jobConcurrency,
      serializeFeaturePermissions(newUser.featurePermissions),
      normalizeUserAnalysisModel(newUser.analysisModel),
      newUser.creditLimitMode,
      newUser.creditBalance,
      newUser.creditReserved,
      newUser.creditConsumed,
      newUser.passwordHash,
      newUser.salt,
      newUser.createdAt,
      newUser.lastLoginAt,
    ]
  );
  await saveDbAppState(newUser.id, createDefaultState());
  return newUser;
};

const updateDbUser = async (userId, updates, poolOverride = null) => {
  const pool = poolOverride || await getMysqlPool();
  const fields = [];
  const values = [];

  if (typeof updates.displayName === 'string') {
    fields.push('display_name = ?');
    values.push(updates.displayName.trim() || updates.usernameFallback || '');
  }
  if (updates.avatarUrl === null) {
    fields.push('avatar_url = ?');
    values.push(null);
  } else if (typeof updates.avatarUrl === 'string') {
    fields.push('avatar_url = ?');
    values.push(updates.avatarUrl.trim().slice(0, 1024) || null);
  }
  if (updates.avatarPreset === null) {
    fields.push('avatar_preset = ?');
    values.push('aurora');
  } else if (typeof updates.avatarPreset === 'string') {
    fields.push('avatar_preset = ?');
    values.push(updates.avatarPreset.trim().slice(0, 40) || 'aurora');
  }
  if (updates.role === 'admin' || updates.role === 'staff') {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.status === 'active' || updates.status === 'disabled') {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.jobConcurrency !== undefined) {
    fields.push('job_concurrency = ?');
    values.push(normalizeJobConcurrency(updates.jobConcurrency, DEFAULT_JOB_CONCURRENCY));
  }
  if (updates.featurePermissions !== undefined) {
    fields.push('feature_permissions_json = ?');
    values.push(serializeFeaturePermissions(updates.featurePermissions));
  }
  if (updates.analysisModel !== undefined) {
    fields.push('analysis_model = ?');
    values.push(normalizeUserAnalysisModel(updates.analysisModel) || null);
  }
  if (updates.creditLimitMode !== undefined) {
    fields.push('credit_limit_mode = ?');
    values.push(normalizeCreditLimitMode(updates.creditLimitMode));
  }
  if (updates.creditBalance !== undefined) {
    fields.push('credit_balance = ?');
    values.push(normalizeCreditBalanceInput(updates.creditBalance));
  }
  if (typeof updates.password === 'string' && updates.password) {
    const passwordRecord = createPasswordRecord(updates.password);
    fields.push('password_hash = ?');
    values.push(passwordRecord.hash);
    fields.push('salt = ?');
    values.push(passwordRecord.salt);
  }

  if (fields.length === 0) {
    return await findAnyDbUserById(userId, pool);
  }

  values.push(userId);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  return await findAnyDbUserById(userId, pool);
};

const updateDbAllUsersAnalysisModel = async (analysisModel) => {
  const pool = await getMysqlPool();
  const normalized = normalizeUserAnalysisModel(analysisModel);
  await pool.query('UPDATE users SET analysis_model = ?', [normalized || null]);
  return normalized;
};

const updateLocalAllUsersAnalysisModel = (store, analysisModel) => {
  const normalized = normalizeUserAnalysisModel(analysisModel);
  store.users = (store.users || []).map((user) => ({
    ...user,
    analysisModel: normalized,
  }));
  return normalized;
};

const deleteDbUser = async (userId) => {
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  const toPlaceholders = (items) => items.map(() => '?').join(', ');
  let ownerLockName = '';
  let agentLockNames = [];
  let userLockNames = [];
  let agentIds = [];
  let transactionStarted = false;
  try {
    ownerLockName = await acquireManagedAssetAgentOwnerLock(connection, userId);
    const [agentRows] = await connection.query('SELECT id FROM agents WHERE owner_user_id = ?', [userId]);
    agentIds = (agentRows || []).map((row) => row.id).filter(Boolean);
    agentLockNames = await acquireManagedAssetAgentLocks(connection, agentIds);
    await assertNoPendingDbAgentChatRuns(connection, { agentIds });
    let sessionOwnerIds = [];
    if (agentIds.length > 0) {
      const agentPlaceholders = toPlaceholders(agentIds);
      const [sessionOwnerRows] = await connection.query(
        `SELECT DISTINCT user_id FROM chat_sessions WHERE agent_id IN (${agentPlaceholders})`,
        agentIds,
      );
      sessionOwnerIds = (sessionOwnerRows || []).map((row) => row.user_id);
    }
    const affectedUserIds = [userId, ...sessionOwnerIds];
    userLockNames = await acquireManagedAssetUserLocks(connection, affectedUserIds);
    await connection.beginTransaction();
    transactionStarted = true;

    const [assetRows] = await connection.query(
      'SELECT id, provider, storage_key, storage_bucket, storage_region FROM stored_assets WHERE user_id = ?',
      [userId],
    );
    for (const asset of assetRows || []) {
      if (!asset.storage_key) continue;
      const storageProvider = getStoredAssetStorageProvider(asset);
      const storageBucket = storageProvider === 'tencent_cos' ? String(asset.storage_bucket || '').trim() : '';
      const storageRegion = storageProvider === 'tencent_cos' ? String(asset.storage_region || '').trim() : '';
      if (storageProvider === 'tencent_cos' && (!storageBucket || !storageRegion)) {
        throw Object.assign(new Error('账号素材缺少 COS bucket/region 快照，已停止删除账号'), {
          code: 'managed_asset_storage_snapshot_missing',
        });
      }
      await enqueueAssetCleanupTask(connection, {
        assetId: asset.id,
        provider: storageProvider,
        bucket: storageBucket,
        region: storageRegion,
        storageKey: asset.storage_key,
        action: 'delete',
        reason: 'account_deleted',
      });
    }

    if (agentIds.length > 0) {
      const agentPlaceholders = toPlaceholders(agentIds);
      const [versionRows] = await connection.query(
        `SELECT id FROM agent_versions WHERE agent_id IN (${agentPlaceholders})`,
        agentIds
      );
      const versionIds = (versionRows || []).map((row) => row.id).filter(Boolean);
      if (versionIds.length > 0) {
        await connection.query(`DELETE FROM agent_version_knowledge_bases WHERE agent_version_id IN (${toPlaceholders(versionIds)})`, versionIds);
      }
      await connection.query(`DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE agent_id IN (${agentPlaceholders}))`, agentIds);
      await connection.query(`DELETE FROM chat_sessions WHERE agent_id IN (${agentPlaceholders})`, agentIds);
      await connection.query(`DELETE FROM agent_usage_logs WHERE agent_id IN (${agentPlaceholders})`, agentIds);
      await connection.query(`DELETE FROM agent_versions WHERE agent_id IN (${agentPlaceholders})`, agentIds);
      await connection.query(`DELETE FROM agents WHERE id IN (${agentPlaceholders})`, agentIds);
    }

    const [knowledgeBaseRows] = await connection.query('SELECT id FROM knowledge_bases WHERE owner_user_id = ?', [userId]);
    const knowledgeBaseIds = (knowledgeBaseRows || []).map((row) => row.id).filter(Boolean);
    if (knowledgeBaseIds.length > 0) {
      const kbPlaceholders = toPlaceholders(knowledgeBaseIds);
      await connection.query(`DELETE FROM knowledge_chunks WHERE knowledge_base_id IN (${kbPlaceholders})`, knowledgeBaseIds);
      await connection.query(`DELETE FROM knowledge_documents WHERE knowledge_base_id IN (${kbPlaceholders})`, knowledgeBaseIds);
      await connection.query(`DELETE FROM agent_version_knowledge_bases WHERE knowledge_base_id IN (${kbPlaceholders})`, knowledgeBaseIds);
      await connection.query(`DELETE FROM knowledge_bases WHERE id IN (${kbPlaceholders})`, knowledgeBaseIds);
    }

    await connection.query('DELETE FROM chat_messages WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM chat_sessions WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM agent_usage_logs WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM internal_jobs WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM account_credit_ledger WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM stored_assets WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM app_states WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM internal_logs WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM users WHERE id = ?', [userId]);

    await connection.commit();
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    await releaseManagedAssetLocks(connection, userLockNames);
    await releaseManagedAssetLocks(connection, agentLockNames);
    if (ownerLockName) await releaseManagedAssetUserLock(connection, ownerLockName).catch(() => null);
    connection.release();
  }
};

const countDbAdmins = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role = ? AND status = ?', ['admin', 'active']);
  return Number(rows[0]?.count || 0);
};

const purgeExpiredDbLogs = async () => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM internal_logs WHERE created_at < ?', [getLogRetentionCutoff()]);
};

const cleanupExpiredLogs = async () => {
  if (shouldUseMysql) {
    await purgeExpiredDbLogs();
    return;
  }
  await mutateLocalStore((store) => {
    store.logs = normalizeLogs(store.logs);
  });
};

const USAGE_MODULES = new Set(['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video', 'xhs_cover']);
const TERMINAL_STATUSES = new Set(['success', 'failed', 'interrupted']);
const USAGE_ACTIONS = new Set([
  'agent_chat',
  'agent_validate',
  'analysis_token_usage',
  'generate_main_scheme', 'generate_detail_scheme',
  'generate_single',
  'generate_board', 'regenerate_board',
  'create_image_task',
]);
const USAGE_JOB_COMPLETED_TASK_TYPES = new Set(['dreamina_video', 'kie_seedance_video', 'kie_video', 'kie_veo', 'maxforai_video']);

const shouldTrackUsageStatLog = (log = {}) => {
  if (!USAGE_MODULES.has(log.module) || !TERMINAL_STATUSES.has(log.status)) {
    return false;
  }
  if (USAGE_ACTIONS.has(log.action)) {
    return true;
  }
  if (log.action === 'job_completed') {
    return USAGE_JOB_COMPLETED_TASK_TYPES.has(String(log.meta?.taskType || ''));
  }
  return false;
};

const extractUsageCreditsConsumed = (log = {}) => {
  if (log.status !== 'success') return 0;
  const parsed = Number(log.meta?.creditsConsumed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const incrementDbUsageStat = async (pool, log) => {
  if (!shouldTrackUsageStatLog(log)) {
    return;
  }

  const statDate = new Date(log.createdAt).toISOString().split('T')[0];
  const field = log.status === 'success' ? 'success_count' : log.status === 'failed' ? 'failed_count' : 'interrupted_count';
  const creditsConsumed = extractUsageCreditsConsumed(log);

  await pool.query(
    `INSERT INTO usage_daily (stat_date, user_id, username, display_name, module, ${field}, credits_consumed)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE ${field} = ${field} + 1, credits_consumed = credits_consumed + VALUES(credits_consumed)`,
    [statDate, log.userId, log.username, log.displayName, log.module, creditsConsumed]
  );
};

const createDbLog = async (payload) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const log = createLogEntry(payload);
  await pool.query(
    `INSERT INTO internal_logs (
      id, created_at, level, module, action, message, detail, status, user_id, username, display_name, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.createdAt,
      log.level,
      log.module,
      log.action,
      log.message,
      log.detail || null,
      log.status,
      log.userId,
      log.username,
      log.displayName,
      log.meta ? JSON.stringify(log.meta) : null,
    ]
  );
  await incrementDbUsageStat(pool, log);
  return log;
};

const insertDbCreditLedgerEntry = async (connection, user, {
  action,
  amount,
  jobId = '',
  requestId = '',
  module = '',
  taskType = '',
  provider = '',
  reason = '',
  reservationId = '',
  id: sourceReservationId = '',
  meta = null,
}) => {
  const ledgerId = createEntityId();
  const resolvedReservationId = String(reservationId || sourceReservationId || (action === 'reserve' ? ledgerId : '') || '').trim();
  await connection.query(
    `INSERT INTO account_credit_ledger (
      id, reservation_id, user_id, job_id, request_id, module, task_type, provider, action,
      amount, balance_after, reserved_after, reason, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ledgerId,
      resolvedReservationId || null,
      user.id,
      jobId || null,
      requestId || null,
      module || null,
      taskType || null,
      provider || null,
      action,
      normalizeCreditBalanceInput(amount),
      normalizeCreditBalanceInput(user.creditBalance),
      normalizeCreditBalanceInput(user.creditReserved),
      reason || null,
      meta ? JSON.stringify(meta) : null,
      Date.now(),
    ]
  );
  return { id: ledgerId, reservationId: resolvedReservationId };
};

const hasDbProcessedCreditReservation = async (connection, reservation) => {
  const reservationId = String(reservation?.id || '').trim();
  if (!reservationId) return false;
  const [rows] = await connection.query(
    `SELECT id FROM account_credit_ledger
     WHERE reservation_id = ? AND action IN ('settle', 'release')
     LIMIT 1`,
    [reservationId]
  );
  return Boolean(rows?.[0]);
};

const borrowDbConnection = async (poolOrConnection) => {
  if (typeof poolOrConnection?.getConnection === 'function') {
    const connection = await poolOrConnection.getConnection();
    return { connection, ownsTransaction: true, release: () => connection.release() };
  }
  if (typeof poolOrConnection?.query !== 'function') {
    throw new TypeError('MySQL pool or connection is required.');
  }
  return { connection: poolOrConnection, ownsTransaction: false, release: () => {} };
};

const reserveDbAccountCredits = async (poolOrConnection, user, context = {}) => {
  const account = normalizeCreditAccount(user);
  if (account.creditLimitMode !== CREDIT_LIMIT_MODES.LIMITED) return null;
  const amount = normalizeCreditBalanceInput(context.amount);
  if (amount <= 0) return null;
  const borrowed = await borrowDbConnection(poolOrConnection);
  const { connection, ownsTransaction } = borrowed;
  try {
    if (ownsTransaction) await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE users
       SET credit_reserved = credit_reserved + ?
       WHERE id = ?
         AND credit_limit_mode = 'limited'
         AND (credit_balance - credit_reserved) >= ?`,
      [amount, account.id, amount]
    );
    if (!result?.affectedRows) {
      const [rows] = await connection.query('SELECT * FROM users WHERE id = ? LIMIT 1', [account.id]);
      if (ownsTransaction) await connection.rollback();
      const freshUser = rows[0] ? mapDbUser(rows[0]) : account;
      const error = new Error(`积分不足：需要 ${amount} 积分，当前可用 ${normalizeCreditBalanceInput(getCreditAvailable(freshUser))} 积分。`);
      error.code = 'account_credit_insufficient';
      error.statusCode = 402;
      error.requiredCredits = amount;
      error.availableCredits = normalizeCreditBalanceInput(getCreditAvailable(freshUser));
      throw error;
    }
    const [rows] = await connection.query('SELECT * FROM users WHERE id = ? LIMIT 1', [account.id]);
    const updatedUser = mapDbUser(rows[0]);
    const reservation = {
      id: createEntityId(),
      userId: updatedUser.id,
      amount,
      jobId: String(context.jobId || ''),
      requestId: String(context.requestId || ''),
      module: String(context.module || ''),
      taskType: String(context.taskType || ''),
      provider: String(context.provider || ''),
    };
    await insertDbCreditLedgerEntry(connection, updatedUser, {
      ...reservation,
      action: 'reserve',
      reason: context.reason || 'reserve',
    });
    if (ownsTransaction) await connection.commit();
    return reservation;
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    borrowed.release();
  }
};

const getProviderCreditsConsumed = (result) => {
  const source = result && typeof result === 'object' && 'result' in result ? result.result : result;
  const parsed = Number(source?.creditsConsumed ?? source?.usage?.credits ?? source?.usage?.creditsConsumed);
  return Number.isFinite(parsed) && parsed >= 0 ? normalizeCreditBalanceInput(parsed) : undefined;
};

const lockDbCreditAccount = async (connection, userId) => {
  const [rows] = await connection.query(
    'SELECT * FROM users WHERE id = ? FOR UPDATE',
    [userId]
  );
  return rows?.[0] ? mapDbUser(rows[0]) : null;
};

const settleDbAccountCredits = async (poolOrConnection, reservation, context = {}) => {
  if (!reservation?.userId || !(Number(reservation.amount) > 0)) return null;
  const providerCredits = getProviderCreditsConsumed(context.result);
  const reservedAmount = normalizeCreditBalanceInput(reservation.amount);
  const settledAmount = providerCredits === undefined ? reservedAmount : providerCredits;
  const borrowed = await borrowDbConnection(poolOrConnection);
  const { connection, ownsTransaction } = borrowed;
  try {
    if (ownsTransaction) await connection.beginTransaction();
    if (!await lockDbCreditAccount(connection, reservation.userId)) {
      if (ownsTransaction) await connection.rollback();
      return null;
    }
    if (await hasDbProcessedCreditReservation(connection, reservation)) {
      if (ownsTransaction) await connection.commit();
      return { alreadyProcessed: true };
    }
    await connection.query(
      `UPDATE users
       SET credit_reserved = GREATEST(0, credit_reserved - ?),
           credit_balance = GREATEST(0, credit_balance - ?),
           credit_consumed = credit_consumed + ?
       WHERE id = ?`,
      [reservedAmount, settledAmount, settledAmount, reservation.userId]
    );
    const [rows] = await connection.query('SELECT * FROM users WHERE id = ? LIMIT 1', [reservation.userId]);
    if (!rows[0]) {
      if (ownsTransaction) await connection.rollback();
      return null;
    }
    const updatedUser = mapDbUser(rows[0]);
    await insertDbCreditLedgerEntry(connection, updatedUser, {
      ...reservation,
      ...context,
      action: 'settle',
      amount: settledAmount,
      reason: context.reason || 'settle',
      meta: {
        ...(context.meta && typeof context.meta === 'object' ? context.meta : {}),
        reservedAmount,
        overageAmount: Math.max(0, normalizeCreditBalanceInput(settledAmount - reservedAmount)),
        source: providerCredits === undefined ? 'estimate' : 'provider',
      },
    });
    if (ownsTransaction) await connection.commit();
    return {
      settledAmount,
      source: providerCredits === undefined ? 'estimate' : 'provider',
    };
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    borrowed.release();
  }
};

const releaseDbAccountCredits = async (poolOrConnection, reservation, context = {}) => {
  if (!reservation?.userId || !(Number(reservation.amount) > 0)) return null;
  const amount = normalizeCreditBalanceInput(reservation.amount);
  const borrowed = await borrowDbConnection(poolOrConnection);
  const { connection, ownsTransaction } = borrowed;
  try {
    if (ownsTransaction) await connection.beginTransaction();
    if (!await lockDbCreditAccount(connection, reservation.userId)) {
      if (ownsTransaction) await connection.rollback();
      return null;
    }
    if (await hasDbProcessedCreditReservation(connection, reservation)) {
      if (ownsTransaction) await connection.commit();
      return { alreadyProcessed: true };
    }
    await connection.query(
      `UPDATE users
       SET credit_reserved = GREATEST(0, credit_reserved - ?)
       WHERE id = ?`,
      [amount, reservation.userId]
    );
    const [rows] = await connection.query('SELECT * FROM users WHERE id = ? LIMIT 1', [reservation.userId]);
    if (!rows[0]) {
      if (ownsTransaction) await connection.rollback();
      return null;
    }
    const updatedUser = mapDbUser(rows[0]);
    await insertDbCreditLedgerEntry(connection, updatedUser, {
      ...reservation,
      ...context,
      action: 'release',
      amount,
      reason: context.reason || 'release',
    });
    if (ownsTransaction) await connection.commit();
    return { releasedAmount: amount };
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    borrowed.release();
  }
};

const reserveDbJobCredits = async (pool, user, jobPayload) => {
  const amount = estimateCreditReservation(jobPayload);
  return await reserveDbAccountCredits(pool, user, {
    amount,
    module: jobPayload.module,
    taskType: jobPayload.taskType,
    provider: jobPayload.provider,
    reason: 'job_created',
  });
};

const reserveDbJobCreditsForSubmission = async (pool, user, jobPayload) => {
  const creditReservation = await reserveDbJobCredits(pool, user, jobPayload);
  return creditReservation;
};

const createDbJobRecordWithReservation = async (pool, user, jobPayload, creditReservation) => {
  const job = await createJobRecord(pool, user, attachCreditReservationToJobPayload(jobPayload, creditReservation));
  return job;
};

const reserveLocalJobCredits = (store, user, jobPayload) => {
  const amount = estimateCreditReservation(jobPayload);
  return reserveLocalAccountCredits(store, user.id, {
    amount,
    module: jobPayload.module,
    taskType: jobPayload.taskType,
    provider: jobPayload.provider,
    reason: 'job_created',
  });
};

const settleDbJobCredits = async ({ pool, job, output, finishedAt, aborted, rejected = false }) => {
  const reservation = getCreditReservationFromJob(job);
  if (!reservation) return null;
  if (aborted) {
    const creditJob = {
      ...job,
      providerTaskId: String(output?.providerTaskId || job?.providerTaskId || ''),
    };
    if (!shouldReleaseJobCreditReservation({ job: creditJob, error: { code: 'request_cancelled' }, aborted: true })) {
      return null;
    }
    return await releaseDbAccountCredits(pool, reservation, {
      module: job.module,
      taskType: job.taskType,
      provider: job.provider,
      reason: 'job_cancelled',
      meta: { finishedAt },
    });
  }
  return await settleDbAccountCredits(pool, reservation, {
    result: output,
    module: job.module,
    taskType: job.taskType,
    provider: job.provider,
    reason: rejected ? 'job_completed_output_rejected' : 'job_completed',
    meta: { finishedAt },
  });
};

const releaseDbJobCredits = async ({ pool, job, error, finishedAt, retryWaiting }) => {
  const reservation = getCreditReservationFromJob(job);
  if (!reservation) return null;
  if (!shouldReleaseJobCreditReservation({ job, error, retryWaiting })) return null;
  return await releaseDbAccountCredits(pool, reservation, {
    module: job.module,
    taskType: job.taskType,
    provider: job.provider,
    reason: error?.code === 'request_cancelled' ? 'job_cancelled' : 'job_failed',
    meta: {
      finishedAt,
      errorCode: error?.code || '',
      errorMessage: String(error?.message || '').slice(0, 500),
    },
  });
};

const settleLocalJobCredits = ({ store, job, output, aborted, rejected = false }) => {
  const reservation = getCreditReservationFromJob(job);
  if (!reservation) return null;
  if (aborted) {
    const creditJob = {
      ...job,
      providerTaskId: String(output?.providerTaskId || job?.providerTaskId || ''),
    };
    if (!shouldReleaseJobCreditReservation({ job: creditJob, error: { code: 'request_cancelled' }, aborted: true })) {
      return null;
    }
    return releaseLocalAccountCredits(store, reservation, {
      module: job.module,
      taskType: job.taskType,
      provider: job.provider,
      reason: 'job_cancelled',
    });
  }
  return settleLocalAccountCredits(store, reservation, {
    result: output,
    module: job.module,
    taskType: job.taskType,
    provider: job.provider,
    reason: rejected ? 'job_completed_output_rejected' : 'job_completed',
  });
};

const releaseLocalJobCredits = ({ store, job, error, retryWaiting }) => {
  const reservation = getCreditReservationFromJob(job);
  if (!reservation) return null;
  if (!shouldReleaseJobCreditReservation({ job, error, retryWaiting })) return null;
  return releaseLocalAccountCredits(store, reservation, {
    module: job.module,
    taskType: job.taskType,
    provider: job.provider,
    reason: error?.code === 'request_cancelled' ? 'job_cancelled' : 'job_failed',
  });
};

const reserveDbAgentImageCredits = async (pool, user, { sessionId = '', clientRequestId = '', taskType = 'agent_image', model = '' } = {}) => {
  const provider = isMaxForAiImageModel(model) ? 'maxforai' : 'kie';
  const amount = estimateCreditReservation({
    taskType: taskType || 'agent_image',
    provider,
    payload: { outputCount: 1, model },
  });
  return await reserveDbAccountCredits(pool, user, {
    amount,
    module: 'agent_center',
    taskType: taskType || 'agent_image',
    provider,
    requestId: clientRequestId,
    reason: 'agent_image_generation',
    meta: { sessionId, clientRequestId },
  });
};

const settleDbAgentImageCredits = async (pool, reservation, { result, sessionId = '', clientRequestId = '' } = {}) => (
  await settleDbAccountCredits(pool, reservation, {
    result,
    module: 'agent_center',
    taskType: reservation?.taskType || 'agent_image',
    provider: reservation?.provider || 'kie',
    requestId: clientRequestId,
    reason: 'agent_image_completed',
    meta: { sessionId, clientRequestId },
  })
);

const releaseDbAgentImageCredits = async (pool, reservation, { error, sessionId = '', clientRequestId = '' } = {}) => (
  await releaseDbAccountCredits(pool, reservation, {
    module: 'agent_center',
    taskType: reservation?.taskType || 'agent_image',
    provider: reservation?.provider || 'kie',
    requestId: clientRequestId,
    reason: 'agent_image_failed',
    meta: {
      sessionId,
      clientRequestId,
      errorCode: error?.code || '',
      errorMessage: String(error?.message || '').slice(0, 500),
    },
  })
);

const reserveLocalAgentImageCredits = (store, user, { sessionId = '', clientRequestId = '', taskType = 'agent_image', model = '' } = {}) => {
  const provider = isMaxForAiImageModel(model) ? 'maxforai' : 'kie';
  const amount = estimateCreditReservation({
    taskType: taskType || 'agent_image',
    provider,
    payload: { outputCount: 1, model },
  });
  return reserveLocalAccountCredits(store, user.id, {
    amount,
    module: 'agent_center',
    taskType: taskType || 'agent_image',
    provider,
    requestId: clientRequestId,
    reason: 'agent_image_generation',
    meta: { sessionId, clientRequestId },
  });
};

const settleLocalAgentImageCredits = (store, reservation, { result, sessionId = '', clientRequestId = '' } = {}) => (
  settleLocalAccountCredits(store, reservation, {
    result,
    module: 'agent_center',
    taskType: reservation?.taskType || 'agent_image',
    provider: reservation?.provider || 'kie',
    requestId: clientRequestId,
    reason: 'agent_image_completed',
    meta: { sessionId, clientRequestId },
  })
);

const releaseLocalAgentImageCredits = (store, reservation, { error, sessionId = '', clientRequestId = '' } = {}) => (
  releaseLocalAccountCredits(store, reservation, {
    module: 'agent_center',
    taskType: reservation?.taskType || 'agent_image',
    provider: reservation?.provider || 'kie',
    requestId: clientRequestId,
    reason: 'agent_image_failed',
    meta: {
      sessionId,
      clientRequestId,
      errorCode: error?.code || '',
      errorMessage: String(error?.message || '').slice(0, 500),
    },
  })
);

const TERMINAL_CREDIT_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

const buildDbCreditJobFromRow = (row = {}) => ({
  id: row.id,
  userId: row.user_id,
  module: row.module,
  taskType: row.task_type,
  provider: row.provider,
  status: row.status,
  payload: parseJsonField(row.payload_json, {}),
  result: parseJsonField(row.result_json, null),
  providerTaskId: row.provider_task_id || '',
  errorCode: row.error_code || '',
  errorMessage: row.error_message || '',
  finishedAt: row.finished_at === null ? null : Number(row.finished_at || 0),
});

const reconcileDbTerminalJobCredits = async (pool, { limit = 500 } = {}) => {
  const [rows] = await pool.query(
    `SELECT id, user_id, module, task_type, provider, status, payload_json, result_json,
            provider_task_id, error_code, error_message, finished_at
     FROM internal_jobs
     WHERE status IN ('succeeded', 'failed', 'cancelled')
       AND payload_json LIKE '%__creditReservation%'
     ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
     LIMIT ?`,
    [Math.max(1, Math.min(5000, Number(limit || 500)))]
  );
  let reconciled = 0;
  for (const row of rows || []) {
    const job = buildDbCreditJobFromRow(row);
    if (!getCreditReservationFromJob(job)) continue;
    const completedOutputRejected = shouldSettleProviderCompletedRejectedJob(job);
    const result = job.status === 'succeeded' || completedOutputRejected
      ? await settleDbJobCredits({
          pool,
          job,
          output: { providerTaskId: job.providerTaskId, result: job.result },
          finishedAt: job.finishedAt || Date.now(),
          aborted: false,
          rejected: completedOutputRejected,
        })
      : await releaseDbJobCredits({
          pool,
          job,
          error: { code: job.errorCode || (job.status === 'cancelled' ? 'request_cancelled' : 'job_failed'), message: job.errorMessage || '' },
          finishedAt: job.finishedAt || Date.now(),
          retryWaiting: false,
        });
    if (result && !result.alreadyProcessed) reconciled += 1;
  }
  return reconciled;
};

const runTombstonedJobCleanupCycle = async () => {
  if (!shouldUseMysql || tombstonedJobReconcilerRunning) return { skipped: true };
  tombstonedJobReconcilerRunning = true;
  const errorCodes = [];
  try {
    const pool = await getMysqlPool();
    const updatedAfter = tombstonedStateScanTracker.getUpdatedAfter();
    const [changedRows] = updatedAfter > 0
      ? await pool.query(
          'SELECT user_id, state_json, updated_at FROM app_states WHERE updated_at >= ? ORDER BY updated_at ASC',
          [updatedAfter],
        )
      : await pool.query('SELECT user_id, state_json, updated_at FROM app_states ORDER BY updated_at ASC');
    const rows = tombstonedStateScanTracker.prepareRows(changedRows);
    const pendingJobIdsByUser = new Map();
    const stats = await reconcileTombstonedJobs({
      stateRows: rows,
      loadJobs: async (userId, jobIds) => {
        const jobs = await listJobsByIdsForUser(pool, userId, jobIds);
        return Promise.all(jobs.map(async (job) => {
          const reservation = getCreditReservationFromJob(job);
          const pendingReservation = Boolean(
            reservation && !await hasDbProcessedCreditReservation(pool, reservation),
          );
          return { ...job, pendingReservation };
        }));
      },
      cancelJob: async (job) => {
        const user = await findDbUserById(job.userId);
        if (!user) return job;
        const outcome = await requestCancelJob(pool, job, {
          user,
          releaseQueuedCredits: async (connection, freshJob, finishedAt) => (
            releaseDbJobCredits({
              pool: connection,
              job: freshJob,
              error: { code: 'request_cancelled', message: '用户删除了排队任务' },
              finishedAt,
              retryWaiting: false,
            })
          ),
        });
        if (String(job.status) === 'running') jobWorker?.cancelActiveJob(job.id);
        return outcome.job;
      },
      recoverSubmittedCancelledJob: async (job) => {
        const recoveredJob = await requestTombstonedJobRecovery(pool, job);
        if (['queued', 'retry_waiting'].includes(String(recoveredJob.status || ''))) {
          await mirrorDbJobToTemporalIfEnabled(pool, recoveredJob);
          if (normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE) !== 'temporal') {
            jobWorker?.trigger?.();
          }
        } else {
          await recordDbTaskPlatformEvent(pool, recoveredJob, {
            stage: 'failed',
            eventName: 'tombstone_recovery_manual_required',
            status: 'failed',
            providerSubmitted: Boolean(recoveredJob.providerTaskId),
            providerTaskId: recoveredJob.providerTaskId || '',
            retryable: false,
            errorCode: recoveredJob.errorCode,
            errorMessage: recoveredJob.errorMessage,
          });
        }
        return recoveredJob;
      },
      deleteJob: (job) => withManagedAssetUserLock(job.userId, (lockedPool) => (
        deleteJobById(lockedPool, job.id, {
          userId: job.userId,
          hasPendingReservation: async (connection, freshJob) => {
            const reservation = getCreditReservationFromJob(freshJob);
            return Boolean(reservation && !await hasDbProcessedCreditReservation(connection, reservation));
          },
          afterDelete: async (connection, deletedJob) => {
            await queueStoredAssetsAfterReferenceRemoval({
              pool: connection,
              assetIds: collectStoredAssetIdsFromJob(deletedJob),
              reason: 'job_tombstone_reconciled',
              ownerUserId: job.userId,
            });
          },
        })
      )),
      onError: (error) => {
        const code = String(error?.code || error?.name || 'tombstoned_job_cleanup_failed')
          .replace(/[^a-zA-Z0-9_.-]+/g, '_')
          .slice(0, 80);
        if (errorCodes.length < 5) errorCodes.push(code);
      },
      onPending: ({ userId, jobId }) => {
        const jobIds = pendingJobIdsByUser.get(userId) || [];
        jobIds.push(jobId);
        pendingJobIdsByUser.set(userId, jobIds);
      },
    });
    tombstonedStateScanTracker.commitPending(pendingJobIdsByUser);
    tombstonedJobCleanup = {
      ...stats,
      oldestPendingAgeMs: stats.oldestPendingUpdatedAt
        ? Math.max(0, Date.now() - stats.oldestPendingUpdatedAt)
        : 0,
      alerting: shouldAlertTombstonedJobCleanup(stats, {
        pendingAlertMs: TOMBSTONED_JOB_PENDING_ALERT_MS,
      }),
      lastError: errorCodes.join(','),
      lastCycleAt: Date.now(),
    };
    return tombstonedJobCleanup;
  } catch (error) {
    tombstonedJobCleanup = {
      ...tombstonedJobCleanup,
      errors: tombstonedJobCleanup.errors + 1,
      alerting: true,
      lastError: String(error?.code || error?.name || 'tombstoned_job_cleanup_failed')
        .replace(/[^a-zA-Z0-9_.-]+/g, '_')
        .slice(0, 80),
      lastCycleAt: Date.now(),
    };
    throw error;
  } finally {
    tombstonedJobReconcilerRunning = false;
  }
};

const reconcileLocalTerminalJobCredits = (store, { limit = 500 } = {}) => {
  const jobs = (Array.isArray(store?.jobs) ? store.jobs : [])
    .filter((job) => TERMINAL_CREDIT_JOB_STATUSES.has(String(job?.status || '')) && getCreditReservationFromJob(job))
    .sort((a, b) => Number(b.finishedAt || b.updatedAt || b.createdAt || 0) - Number(a.finishedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(5000, Number(limit || 500))));
  let reconciled = 0;
  for (const job of jobs) {
    const completedOutputRejected = shouldSettleProviderCompletedRejectedJob(job);
    const result = job.status === 'succeeded' || completedOutputRejected
      ? settleLocalJobCredits({
          store,
          job,
          output: { providerTaskId: job.providerTaskId, result: job.result },
          aborted: false,
          rejected: completedOutputRejected,
        })
      : releaseLocalJobCredits({
          store,
          job,
          error: { code: job.errorCode || (job.status === 'cancelled' ? 'request_cancelled' : 'job_failed'), message: job.errorMessage || '' },
          retryWaiting: false,
        });
    if (result && !result.alreadyProcessed) reconciled += 1;
  }
  return reconciled;
};

const reconcileLocalTerminalJobCreditsAfterRestart = () => {
  const store = readLocalStore();
  const reconciled = reconcileLocalTerminalJobCredits(store);
  if (reconciled > 0) writeLocalStore(store);
  return reconciled;
};

const buildDbLogWhere = (filters = {}) => {
  const clauses = ['created_at >= ?'];
  const values = [Math.max(getLogRetentionCutoff(), normalizeLogFilterTimestamp(filters.startAt) || getLogRetentionCutoff())];
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter) {
    clauses.push('module = ?');
    values.push(moduleFilter);
  }
  if (userFilter) {
    clauses.push('user_id = ?');
    values.push(userFilter);
  }
  if (statusFilter) {
    clauses.push('status = ?');
    values.push(statusFilter);
  }
  if (endAt) {
    clauses.push('created_at <= ?');
    values.push(endAt);
  }

  return { clauses, values };
};

const listDbLogs = async (filters = {}) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const { clauses, values } = buildDbLogWhere(filters);
  const { page, pageSize, offset } = normalizeLogPagination(filters);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM internal_logs WHERE ${clauses.join(' AND ')}`,
    values
  );
  const total = Number(countRows[0]?.total || 0);

  const [rows] = await pool.query(
    `SELECT id, created_at, level, module, action, message, detail, status, user_id, username, display_name, meta_json
     FROM internal_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return {
    logs: rows.map((row) => ({
      id: row.id,
      createdAt: Number(row.created_at),
      level: row.level,
      module: row.module,
      action: row.action,
      message: row.message,
      detail: row.detail || '',
      status: row.status,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    })),
    total,
    page,
    pageSize,
  };
};

const listDbLogMeta = async () => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const [rows] = await pool.query(
    `SELECT module, user_id, username, display_name
     FROM internal_logs
     WHERE created_at >= ?
     ORDER BY created_at DESC`,
    [getLogRetentionCutoff()]
  );

  return buildLogFilterOptions(rows.map((row) => ({
    id: row.id,
    module: row.module,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
  })));
};

const deleteDbLogs = async (filters = {}) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();

  const clauses = ['created_at >= ?'];
  const values = [Math.max(getLogRetentionCutoff(), normalizeLogFilterTimestamp(filters.startAt) || getLogRetentionCutoff())];
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter) {
    clauses.push('module = ?');
    values.push(moduleFilter);
  }
  if (userFilter) {
    clauses.push('user_id = ?');
    values.push(userFilter);
  }
  if (statusFilter) {
    clauses.push('status = ?');
    values.push(statusFilter);
  }
  if (endAt) {
    clauses.push('created_at <= ?');
    values.push(endAt);
  }

  const [result] = await pool.query(`DELETE FROM internal_logs WHERE ${clauses.join(' AND ')}`, values);
  return Number(result?.affectedRows || 0);
};

const listDbManageableKnowledgeBaseIds = async (user, ids) => {
  const targetIds = cleanKnowledgeBaseIds(ids);
  if (targetIds.length === 0) return [];
  const pool = await getMysqlPool();
  const placeholders = targetIds.map(() => '?').join(', ');
  const params = isSuperAdminUser(user) ? targetIds : [...targetIds, user.id];
  const where = isSuperAdminUser(user)
    ? `id IN (${placeholders})`
    : `id IN (${placeholders}) AND owner_user_id = ?`;
  const [rows] = await pool.query(`SELECT id FROM knowledge_bases WHERE ${where} AND status = ?`, [...params, 'active']);
  return rows.map((row) => row.id);
};

const syncDbVersionKnowledgeBases = async (agentVersionId, knowledgeBaseIds) => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE agent_version_id = ?', [agentVersionId]);
  const now = Date.now();
  for (const [index, knowledgeBaseId] of cleanKnowledgeBaseIds(knowledgeBaseIds).entries()) {
    await pool.query(
      `INSERT INTO agent_version_knowledge_bases (id, agent_version_id, knowledge_base_id, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [createEntityId(), agentVersionId, knowledgeBaseId, index, now]
    );
  }
};

const listDbVersionKnowledgeBaseIds = async (agentVersionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT knowledge_base_id FROM agent_version_knowledge_bases WHERE agent_version_id = ? ORDER BY priority ASC, created_at ASC',
    [agentVersionId]
  );
  return rows.map((row) => row.knowledge_base_id);
};

const listDbAgentVersionsByAgentId = async (agentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version_no DESC, created_at DESC',
    [agentId]
  );
  const versions = [];
  for (const row of rows) {
    versions.push(normalizeAgentVersionRecord(row, await listDbVersionKnowledgeBaseIds(row.id)));
  }
  return versions;
};

const getDbAgentVersionById = async (versionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM agent_versions WHERE id = ? LIMIT 1', [versionId]);
  if (!rows[0]) return null;
  return normalizeAgentVersionRecord(rows[0], await listDbVersionKnowledgeBaseIds(versionId));
};

const getDbAgentById = async (agentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT a.*, u.display_name AS owner_display_name
     FROM agents a
     LEFT JOIN users u ON u.id = a.owner_user_id
     WHERE a.id = ? LIMIT 1`,
    [agentId]
  );
  if (!rows[0]) return null;
  const currentVersion = rows[0].current_version_id ? await getDbAgentVersionById(rows[0].current_version_id) : null;
  const [kbCountRows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM agent_version_knowledge_bases
     WHERE agent_version_id = ?`,
    [rows[0].current_version_id || '']
  );
  const [usageRows] = await pool.query(
    'SELECT COUNT(*) AS count FROM agent_usage_logs WHERE agent_id = ? AND created_at >= ?',
    [agentId, Date.now() - AGENT_SUMMARY_WINDOW_MS]
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    department: rows[0].department,
    iconUrl: rows[0].icon_url || '',
    avatarPreset: rows[0].avatar_preset || '',
    factoryAgentId: rows[0].factory_agent_id || '',
    ownerUserId: rows[0].owner_user_id,
    ownerDisplayName: rows[0].owner_display_name || '',
    visibilityScope: rows[0].visibility_scope,
    status: normalizeAgentStatus(rows[0].status),
    currentVersionId: rows[0].current_version_id,
    currentVersionNo: currentVersion?.versionNo || null,
    defaultModel: currentVersion?.modelPolicy?.defaultModel || '',
    knowledgeBaseCount: Number(kbCountRows[0]?.count || 0),
    usageCount7d: Number(usageRows[0]?.count || 0),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const listDbAgents = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE a.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT a.*, u.display_name AS owner_display_name
     FROM agents a
     LEFT JOIN users u ON u.id = a.owner_user_id
     ${where}
     ORDER BY a.updated_at DESC`,
    params
  );
  const items = [];
  for (const row of rows) {
    items.push(await getDbAgentById(row.id));
  }
  return items.filter(Boolean);
};

const createDbAgentUnlocked = async (user, payload, pool) => {
  const now = Date.now();
  const agentId = createEntityId();
  const version = buildAgentVersionInsertRecord({
    agentId,
    versionNo: 1,
    createdBy: user.id,
    source: {
      systemPrompt: payload.systemPrompt || '',
      allowedChatModels: payload.allowedChatModels || [],
      defaultChatModel: payload.defaultChatModel || '',
      knowledgeDocumentBindings: payload.knowledgeDocumentBindings || [],
      replyStyleRules: payload.replyStyleRules || {},
      modelPolicy: payload.modelPolicy || {},
      contextPolicy: payload.contextPolicy || {},
      retrievalPolicy: payload.retrievalPolicy || {},
      toolPolicy: payload.toolPolicy || {},
      knowledgeBaseIds: await listDbManageableKnowledgeBaseIds(user, payload.knowledgeBaseIds || []),
    },
  });

  await pool.query(
    `INSERT INTO agents (id, name, description, department, owner_user_id, visibility_scope, status, current_version_id, icon_url, avatar_preset, factory_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      String(payload.name || '未命名智能体').slice(0, 120),
      String(payload.description || '').slice(0, 5000),
      String(payload.department || '未分组').slice(0, 120),
      user.id,
      AGENT_VISIBILITY_SCOPE,
      'draft',
      null,
      payload.iconUrl ? String(payload.iconUrl).slice(0, 1024) : null,
      payload.avatarPreset ? String(payload.avatarPreset).slice(0, 40) : null,
      payload.factoryAgentId ? String(payload.factoryAgentId).slice(0, 120) : null,
      now,
      now,
    ]
  );

  await pool.query(
    `INSERT INTO agent_versions (
      id, agent_id, version_no, version_name, allowed_chat_models_json, default_chat_model, is_published, system_prompt, reply_style_rules_json, model_policy_json,
      context_policy_json, retrieval_policy_json, tool_policy_json, knowledge_document_bindings_json, validation_status, validation_summary_json,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.agentId,
      version.versionNo,
      version.versionName,
      stringifyJsonField(version.allowedChatModels),
      version.defaultChatModel || null,
      version.isPublished,
      version.systemPrompt,
      version.replyStyleRulesJson,
      version.modelPolicyJson,
      version.contextPolicyJson,
      version.retrievalPolicyJson,
      version.toolPolicyJson,
      version.knowledgeDocumentBindingsJson,
      version.validationStatus,
      version.validationSummaryJson,
      version.createdBy,
      version.createdAt,
    ]
  );
  await syncDbVersionKnowledgeBases(version.id, version.knowledgeBaseIds);
  return {
    agent: await getDbAgentById(agentId),
    version: await getDbAgentVersionById(version.id),
  };
};

const createDbAgent = async (user, payload) => {
  const pool = await getMysqlPool();
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let ownerLockName = '';
  let userLockName = '';
  try {
    ownerLockName = await acquireManagedAssetAgentOwnerLock(connection, user.id);
    userLockName = await acquireManagedAssetUserLock(connection, user.id);
    const [ownerRows] = await connection.query('SELECT status FROM users WHERE id = ? LIMIT 1', [user.id]);
    if (!ownerRows?.[0] || ownerRows[0].status !== 'active') {
      const error = new Error('账号已停用或不存在，未创建智能体');
      error.code = 'managed_asset_owner_unavailable';
      error.statusCode = 409;
      throw error;
    }
    await assertOwnedActiveManagedAssetReferences({
      value: payload?.iconUrl,
      userId: user.id,
      pool,
    });
    return createDbAgentUnlocked(user, payload || {}, pool);
  } finally {
    if (userLockName) await releaseManagedAssetUserLock(connection, userLockName).catch(() => null);
    if (ownerLockName) await releaseManagedAssetUserLock(connection, ownerLockName).catch(() => null);
    connection.release();
  }
};

const updateDbAgent = async (user, agentId, payload) => {
  const current = await getDbAgentById(agentId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const pool = await getMysqlPool();
  const nextName = typeof payload.name === 'string' ? payload.name.slice(0, 120) : current.name;
  const nextDescription = typeof payload.description === 'string' ? payload.description.slice(0, 5000) : current.description;
  const nextDepartment = typeof payload.department === 'string' ? payload.department.slice(0, 120) : current.department;
  const nextIconUrl = payload.iconUrl === null ? null : typeof payload.iconUrl === 'string' ? payload.iconUrl.slice(0, 1024) : current.iconUrl || null;
  const nextAvatarPreset = payload.avatarPreset === null ? null : typeof payload.avatarPreset === 'string' ? payload.avatarPreset.slice(0, 40) : current.avatarPreset || null;
  const nextStatus = payload.status ? normalizeAgentStatus(payload.status) : current.status;
  await pool.query(
    'UPDATE agents SET name = ?, description = ?, department = ?, icon_url = ?, avatar_preset = ?, status = ?, updated_at = ? WHERE id = ?',
    [nextName, nextDescription, nextDepartment, nextIconUrl, nextAvatarPreset, nextStatus, Date.now(), agentId]
  );
  return await getDbAgentById(agentId);
};

const deleteDbAgentVersion = async (user, versionId) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version || version.isPublished) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const pool = await getMysqlPool();
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE agent_version_id = ?', [versionId]);
  await pool.query('DELETE FROM agent_versions WHERE id = ?', [versionId]);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), agent.id]);
  return { ok: true, deletedVersionId: versionId };
};

const deleteDbAgent = async (user, agentId) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let agentLockName = '';
  let userLockNames = [];
  let transactionStarted = false;
  try {
    agentLockName = await acquireManagedAssetAgentLock(connection, agentId);
    const [currentAgentRows] = await connection.query(
      'SELECT owner_user_id, icon_url FROM agents WHERE id = ? LIMIT 1',
      [agentId],
    );
    const currentAgent = currentAgentRows?.[0] || null;
    if (!currentAgent || !canManageOwnedResource(user, currentAgent.owner_user_id)) return null;
    await assertNoPendingDbAgentChatRuns(connection, { agentIds: [agentId] });
    const [sessionOwnerRows] = await connection.query(
      'SELECT DISTINCT user_id FROM chat_sessions WHERE agent_id = ?',
      [agentId],
    );
    const affectedUserIds = [
      currentAgent.owner_user_id,
      ...(sessionOwnerRows || []).map((row) => row.user_id),
    ];
    userLockNames = await acquireManagedAssetUserLocks(connection, affectedUserIds);
    await connection.beginTransaction();
    transactionStarted = true;
    const [messageRows] = await connection.query(
      `SELECT message.*
       FROM chat_messages message
       INNER JOIN chat_sessions session ON session.id = message.session_id
       WHERE session.agent_id = ?
       FOR UPDATE`,
      [agentId],
    );
    const assetIds = Array.from(new Set([
      ...collectStoredAssetIdsFromChatMessages(messageRows),
      ...collectStoredAssetIdsFromValue(currentAgent.icon_url),
    ]));
    const [versionRows] = await connection.query('SELECT id FROM agent_versions WHERE agent_id = ? FOR UPDATE', [agentId]);
    const versionIds = (versionRows || []).map((item) => item.id).filter(Boolean);
    if (versionIds.length > 0) {
      const placeholders = versionIds.map(() => '?').join(', ');
      await connection.query(`DELETE FROM agent_version_knowledge_bases WHERE agent_version_id IN (${placeholders})`, versionIds);
      await connection.query(`DELETE FROM agent_versions WHERE id IN (${placeholders})`, versionIds);
    }
    await connection.query(`DELETE message FROM chat_messages message INNER JOIN chat_sessions session ON session.id = message.session_id WHERE session.agent_id = ?`, [agentId]);
    await connection.query('DELETE FROM chat_sessions WHERE agent_id = ?', [agentId]);
    await connection.query('DELETE FROM agent_usage_logs WHERE agent_id = ?', [agentId]);
    await connection.query('DELETE FROM agents WHERE id = ?', [agentId]);
    const cleanup = await queueStoredAssetsAfterReferenceRemoval({
      pool: connection,
      assetIds,
      reason: 'agent_deleted',
      allowAnyOwner: true,
    });
    await connection.commit();
    transactionStarted = false;
    return { ok: true, deletedAgentId: agentId, deletedAssetIds: cleanup.deletedAssetIds };
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    await releaseManagedAssetLocks(connection, userLockNames);
    if (agentLockName) await releaseManagedAssetUserLock(connection, agentLockName).catch(() => null);
    connection.release();
  }
};

const createDbAgentDraft = async (user, agentId) => {
  const current = await getDbAgentById(agentId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const versions = await listDbAgentVersionsByAgentId(agentId);
  const sourceVersion = versions[0] || null;
  const nextVersion = buildAgentVersionInsertRecord({
    agentId,
    versionNo: Math.max(0, ...versions.map((item) => item.versionNo)) + 1,
    createdBy: user.id,
    source: sourceVersion,
  });
  const pool = await getMysqlPool();
  await pool.query(
    `INSERT INTO agent_versions (
      id, agent_id, version_no, version_name, allowed_chat_models_json, default_chat_model, is_published, system_prompt, reply_style_rules_json, model_policy_json,
      context_policy_json, retrieval_policy_json, tool_policy_json, knowledge_document_bindings_json, validation_status, validation_summary_json,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nextVersion.id,
      nextVersion.agentId,
      nextVersion.versionNo,
      nextVersion.versionName,
      stringifyJsonField(nextVersion.allowedChatModels),
      nextVersion.defaultChatModel || null,
      nextVersion.isPublished,
      nextVersion.systemPrompt,
      nextVersion.replyStyleRulesJson,
      nextVersion.modelPolicyJson,
      nextVersion.contextPolicyJson,
      nextVersion.retrievalPolicyJson,
      nextVersion.toolPolicyJson,
      nextVersion.knowledgeDocumentBindingsJson,
      nextVersion.validationStatus,
      nextVersion.validationSummaryJson,
      nextVersion.createdBy,
      nextVersion.createdAt,
    ]
  );
  await syncDbVersionKnowledgeBases(nextVersion.id, nextVersion.knowledgeBaseIds);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), agentId]);
  return await getDbAgentVersionById(nextVersion.id);
};

const updateDbAgentVersion = async (user, versionId, payload) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId) || version.isPublished) return null;
  const config = normalizeAgentConfig({
    systemPrompt: payload.systemPrompt ?? version.systemPrompt,
    knowledgeDocumentBindings: payload.knowledgeDocumentBindings ?? version.knowledgeDocumentBindings,
    replyStyleRules: payload.replyStyleRules ?? version.replyStyleRules,
    modelPolicy: payload.modelPolicy ?? version.modelPolicy,
    contextPolicy: payload.contextPolicy ?? version.contextPolicy,
    retrievalPolicy: payload.retrievalPolicy ?? version.retrievalPolicy,
    toolPolicy: payload.toolPolicy ?? version.toolPolicy,
  });
  const knowledgeBaseIds = await listDbManageableKnowledgeBaseIds(user, payload.knowledgeBaseIds ?? version.knowledgeBaseIds);
  const allowedChatModels = Array.from(new Set((Array.isArray(payload.allowedChatModels) ? payload.allowedChatModels : version.allowedChatModels).map((item) => String(item || '').trim()).filter(Boolean)));
  const defaultChatModel = String(payload.defaultChatModel || version.defaultChatModel || allowedChatModels[0] || config.modelPolicy.defaultModel || '').trim() || '';
  const pool = await getMysqlPool();
  await pool.query(
    `UPDATE agent_versions
     SET version_name = ?, allowed_chat_models_json = ?, default_chat_model = ?, system_prompt = ?, reply_style_rules_json = ?, model_policy_json = ?, context_policy_json = ?,
         retrieval_policy_json = ?, tool_policy_json = ?, knowledge_document_bindings_json = ?, validation_status = ?, validation_summary_json = ?
     WHERE id = ?`,
    [
      normalizeVersionName(payload.versionName, version.versionNo, version.createdAt),
      stringifyJsonField(allowedChatModels),
      defaultChatModel,
      config.systemPrompt,
      stringifyJsonField(config.replyStyleRules),
      stringifyJsonField(config.modelPolicy),
      stringifyJsonField(config.contextPolicy),
      stringifyJsonField(config.retrievalPolicy),
      stringifyJsonField(config.toolPolicy),
      stringifyJsonField(normalizeVersionKnowledgeDocumentBindings(config.knowledgeDocumentBindings, knowledgeBaseIds), []),
      'pending',
      null,
      versionId,
    ]
  );
  await syncDbVersionKnowledgeBases(versionId, knowledgeBaseIds);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), version.agentId]);
  return await getDbAgentVersionById(versionId);
};

const listDbKnowledgeBases = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE kb.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT kb.*, u.display_name AS owner_display_name
     FROM knowledge_bases kb
     LEFT JOIN users u ON u.id = kb.owner_user_id
     ${where}
     ORDER BY kb.updated_at DESC`,
    params
  );
  const items = [];
  for (const row of rows) {
    const [docRows] = await pool.query('SELECT COUNT(*) AS count FROM knowledge_documents WHERE knowledge_base_id = ?', [row.id]);
    const [boundRows] = await pool.query('SELECT COUNT(DISTINCT agent_version_id) AS count FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [row.id]);
    items.push({
      id: row.id,
      name: row.name,
      description: row.description,
      department: row.department,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: row.owner_display_name || '',
      factoryAgentId: row.factory_agent_id || '',
      factoryKnowledgeBaseId: row.factory_kb_id || '',
      status: normalizeKnowledgeBaseStatus(row.status),
      documentCount: Number(docRows[0]?.count || 0),
      boundAgentCount: Number(boundRows[0]?.count || 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    });
  }
  return items;
};

const getDbKnowledgeBaseById = async (knowledgeBaseId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT kb.*, u.display_name AS owner_display_name
     FROM knowledge_bases kb
     LEFT JOIN users u ON u.id = kb.owner_user_id
     WHERE kb.id = ? LIMIT 1`,
    [knowledgeBaseId]
  );
  if (!rows[0]) return null;
  const [docRows] = await pool.query('SELECT COUNT(*) AS count FROM knowledge_documents WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  const [boundRows] = await pool.query('SELECT COUNT(DISTINCT agent_version_id) AS count FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  return {
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    department: rows[0].department,
    ownerUserId: rows[0].owner_user_id,
    ownerDisplayName: rows[0].owner_display_name || '',
    factoryAgentId: rows[0].factory_agent_id || '',
    factoryKnowledgeBaseId: rows[0].factory_kb_id || '',
    status: normalizeKnowledgeBaseStatus(rows[0].status),
    documentCount: Number(docRows[0]?.count || 0),
    boundAgentCount: Number(boundRows[0]?.count || 0),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const createDbKnowledgeBase = async (user, payload) => {
  const pool = await getMysqlPool();
  const now = Date.now();
  const knowledgeBaseId = createEntityId();
  await pool.query(
    `INSERT INTO knowledge_bases (id, name, description, department, owner_user_id, status, factory_agent_id, factory_kb_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      knowledgeBaseId,
      String(payload.name || '未命名知识库').slice(0, 120),
      String(payload.description || '').slice(0, 5000),
      String(payload.department || '未分组').slice(0, 120),
      user.id,
      'active',
      payload.factoryAgentId ? String(payload.factoryAgentId).slice(0, 120) : null,
      payload.factoryKnowledgeBaseId ? String(payload.factoryKnowledgeBaseId).slice(0, 120) : null,
      now,
      now,
    ]
  );
  return await getDbKnowledgeBaseById(knowledgeBaseId);
};

const updateDbKnowledgeBase = async (user, knowledgeBaseId, payload) => {
  const current = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const pool = await getMysqlPool();
  await pool.query(
    'UPDATE knowledge_bases SET name = ?, description = ?, department = ?, status = ?, updated_at = ? WHERE id = ?',
    [
      typeof payload.name === 'string' ? payload.name.slice(0, 120) : current.name,
      typeof payload.description === 'string' ? payload.description.slice(0, 5000) : current.description,
      typeof payload.department === 'string' ? payload.department.slice(0, 120) : current.department,
      payload.status ? normalizeKnowledgeBaseStatus(payload.status) : current.status,
      Date.now(),
      knowledgeBaseId,
    ]
  );
  return await getDbKnowledgeBaseById(knowledgeBaseId);
};

const deleteDbKnowledgeBase = async (user, knowledgeBaseId) => {
  const current = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return 0;
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM knowledge_chunks WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  await pool.query('DELETE FROM knowledge_documents WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  const [result] = await pool.query('DELETE FROM knowledge_bases WHERE id = ?', [knowledgeBaseId]);
  return Number(result.affectedRows || 0);
};

const listDbKnowledgeDocuments = async (user, knowledgeBaseId) => {
  const knowledgeBase = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return [];
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY updated_at DESC',
    [knowledgeBaseId]
  );
  return rows.filter((row) => !isStudioTestChatSession(row)).map((row) => ({
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    sourceType: normalizeSourceType(row.source_type),
    chunkStrategy: normalizeKnowledgeChunkStrategyValue(row.chunk_strategy),
    rawText: row.raw_text,
    normalizationEnabled: Boolean(row.normalization_enabled),
    normalizedText: String(row.normalized_text || ''),
    normalizationError: String(row.normalization_error || ''),
    normalizedStatus: normalizeKnowledgeNormalizedStatus(row.normalized_status),
    chunkSource: normalizeKnowledgeChunkSource(row.chunk_source),
    parseStatus: row.parse_status,
    chunkCount: Number(row.chunk_count || 0),
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
};

const createDbKnowledgeDocument = async (user, payload) => {
  const knowledgeBase = await getDbKnowledgeBaseById(payload.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const pool = await getMysqlPool();
  const rawText = String(payload.rawText || '').trim();
  const chunkStrategy = normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = Boolean(payload.normalizationEnabled);
  const systemSettings = await getDbSystemSettings();
  const normalizationResult = normalizationEnabled
    ? await normalizeKnowledgeDocumentText(rawText, process.env, getUserScopedSystemSettings(systemSettings, user))
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const chunkEmbeddings = await embedChunkContentsSafe(chunks);
  const now = Date.now();
  const documentId = createEntityId();
  await pool.query(
    `INSERT INTO knowledge_documents (
      id, knowledge_base_id, title, source_type, chunk_strategy, storage_asset_id, raw_text, normalization_enabled, normalized_text, normalization_error, normalized_status, chunk_source, parse_status, chunk_count, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      documentId,
      knowledgeBase.id,
      String(payload.title || '未命名文档').slice(0, 255),
      normalizeSourceType(payload.sourceType),
      chunkStrategy,
      null,
      rawText,
      normalizationEnabled ? 1 : 0,
      normalizationResult.normalizedText || null,
      normalizationResult.normalizationError || null,
      normalizationResult.normalizedStatus,
      normalizationResult.chunkSource,
      'parsed',
      chunks.length,
      user.id,
      now,
      now,
    ]
  );
  for (const [index, content] of chunks.entries()) {
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, source_type, content, token_estimate, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createEntityId(),
        documentId,
        knowledgeBase.id,
        index,
        normalizeSourceType(payload.sourceType),
        content,
        estimateTokenCount(content),
        chunkEmbeddings[index] ? JSON.stringify(chunkEmbeddings[index]) : null,
        now,
      ]
    );
  }
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [now, knowledgeBase.id]);
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    await createDbLog({
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${String(payload.title || '未命名文档').slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  const documents = await listDbKnowledgeDocuments(user, knowledgeBase.id);
  return documents.find((item) => item.id === documentId) || null;
};

const updateDbKnowledgeDocument = async (user, documentId, payload) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1', [documentId]);
  if (!rows[0]) return null;
  const existing = rows[0];
  const knowledgeBase = await getDbKnowledgeBaseById(existing.knowledge_base_id);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = typeof payload.rawText === 'string' ? String(payload.rawText).trim() : String(existing.raw_text || '');
  const title = typeof payload.title === 'string' ? String(payload.title).slice(0, 255) : String(existing.title || '未命名文档');
  const sourceType = typeof payload.sourceType === 'string' ? normalizeSourceType(payload.sourceType) : normalizeSourceType(existing.source_type);
  const chunkStrategy = payload.chunkStrategy === undefined ? normalizeKnowledgeChunkStrategyValue(existing.chunk_strategy) : normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = payload.normalizationEnabled === undefined ? Boolean(existing.normalization_enabled) : Boolean(payload.normalizationEnabled);
  const systemSettings = await getDbSystemSettings();
  const normalizationResult = normalizationEnabled
    ? await normalizeKnowledgeDocumentText(rawText, process.env, getUserScopedSystemSettings(systemSettings, user))
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const chunkEmbeddings = await embedChunkContentsSafe(chunks);
  const now = Date.now();
  await pool.query(
    `UPDATE knowledge_documents
     SET title = ?, source_type = ?, chunk_strategy = ?, raw_text = ?, normalization_enabled = ?, normalized_text = ?, normalization_error = ?, normalized_status = ?, chunk_source = ?, parse_status = ?, chunk_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      title,
      sourceType,
      chunkStrategy,
      rawText,
      normalizationEnabled ? 1 : 0,
      normalizationResult.normalizedText || null,
      normalizationResult.normalizationError || null,
      normalizationResult.normalizedStatus,
      normalizationResult.chunkSource,
      'parsed',
      chunks.length,
      now,
      documentId,
    ]
  );
  await pool.query('DELETE FROM knowledge_chunks WHERE document_id = ?', [documentId]);
  for (const [index, content] of chunks.entries()) {
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, source_type, content, token_estimate, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createEntityId(),
        documentId,
        knowledgeBase.id,
        index,
        sourceType,
        content,
        estimateTokenCount(content),
        chunkEmbeddings[index] ? JSON.stringify(chunkEmbeddings[index]) : null,
        now,
      ]
    );
  }
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [now, knowledgeBase.id]);
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    await createDbLog({
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  const documents = await listDbKnowledgeDocuments(user, knowledgeBase.id);
  return documents.find((item) => item.id === documentId) || null;
};

const deleteDbKnowledgeDocument = async (user, documentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1', [documentId]);
  if (!rows[0]) return 0;
  const knowledgeBase = await getDbKnowledgeBaseById(rows[0].knowledge_base_id);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return 0;
  await pool.query('DELETE FROM knowledge_chunks WHERE document_id = ?', [documentId]);
  const [result] = await pool.query('DELETE FROM knowledge_documents WHERE id = ?', [documentId]);
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [Date.now(), knowledgeBase.id]);
  return Number(result?.affectedRows || 0);
};

const listDbKnowledgeChunksForVersion = async (version) => {
  const knowledgeBaseIds = cleanKnowledgeBaseIds(version?.knowledgeBaseIds);
  if (knowledgeBaseIds.length === 0) return [];
  const pool = await getMysqlPool();
  const chunks = [];
  for (const knowledgeBaseId of knowledgeBaseIds) {
    const [documents] = await pool.query(
      'SELECT id FROM knowledge_documents WHERE knowledge_base_id = ?',
      [knowledgeBaseId]
    );
    const availableDocumentIds = documents.map((row) => String(row.id || '').trim()).filter(Boolean);
    const enabledDocumentIds = resolveEnabledKnowledgeDocumentIds(version, knowledgeBaseId, availableDocumentIds);
    if (enabledDocumentIds.size === 0) continue;
    const placeholders = Array.from(enabledDocumentIds).map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT kc.*, kd.title AS document_title
       FROM knowledge_chunks kc
       INNER JOIN knowledge_documents kd ON kd.id = kc.document_id
       WHERE kc.knowledge_base_id = ?
       AND kc.document_id IN (${placeholders})
       ORDER BY kc.created_at DESC, kc.chunk_index ASC`,
      [knowledgeBaseId, ...Array.from(enabledDocumentIds)]
    );
    chunks.push(...rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      knowledgeBaseId: row.knowledge_base_id,
      chunkIndex: Number(row.chunk_index || 0),
      sourceType: row.source_type,
      content: row.content,
      tokenEstimate: Number(row.token_estimate || 0),
      embedding: parseJsonField(row.embedding_json, null),
      documentTitle: row.document_title,
    })));
  }
  return chunks;
};

const TEXT_READABLE_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/xml',
  'application/json', 'application/xml', 'application/csv',
]);
const TEXT_READABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log', '.yaml', '.yml', '.toml', '.ini', '.conf',
]);
const MAX_INLINE_FILE_CHARS = 80_000;

const extractLocalAssetIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    const m = pathname.match(/\/api\/assets\/file\/([a-f0-9]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

const tryReadLocalAssetText = async (pool, assetUrl) => {
  const assetId = extractLocalAssetIdFromUrl(assetUrl);
  if (!assetId) return null;
  const asset = await getStoredAssetById(pool, assetId);
  if (!asset || asset.deletedAt) return null;
  const fullPath = resolveStoredAssetPath(asset);
  if (!fullPath || !existsSync(fullPath)) return null;
  const ext = path.extname(asset.originalName || '').toLowerCase();
  const mime = (asset.mimeType || '').split(';')[0].trim().toLowerCase();
  const isText = TEXT_READABLE_MIME_TYPES.has(mime) || TEXT_READABLE_EXTENSIONS.has(ext);
  if (!isText) return null;
  try {
    const raw = readFileSync(fullPath, 'utf8');
    return raw.slice(0, MAX_INLINE_FILE_CHARS);
  } catch {
    return null;
  }
};

const buildChatMessageContent = (text, attachments = []) => {
  const content = [{ type: 'text', text: String(text || '') }];
  (Array.isArray(attachments) ? attachments : []).forEach((item) => {
    if (!item?.url) return;
    if (item.kind === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url: String(item.url) },
      });
      return;
    }
    content.push({
      type: 'input_file',
      file_url: String(item.url),
      filename: String(item.name || '附件'),
    });
  });
  return content;
};

// 预处理附件：文本类文件读取内容内联到消息文本，避免用 input_file 传远程URL导致模型报错
const inlineTextAttachments = async (pool, text, attachments = []) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return { text, attachments };
  let inlinedText = text;
  const remainingAttachments = [];
  for (const item of attachments) {
    if (item?.kind !== 'file' || !item?.url) { remainingAttachments.push(item); continue; }
    const fileText = await tryReadLocalAssetText(pool, item.url);
    if (fileText != null) {
      inlinedText = `${inlinedText}\n\n【附件：${item.name || '文件'}】\n${fileText}`;
    } else {
      remainingAttachments.push(item);
    }
  }
  return { text: inlinedText, attachments: remainingAttachments };
};

const runAgenticRetrievalLoop = async ({
  userId,
  initialMessages,
  currentMessage,
  selectedModel,
  fallbackModels = [],
  reasoningLevel,
  webSearchEnabled,
  candidateChunks,
  retrievalPolicy,
  maxExtraRounds = 3,
  onProgress = null,
}) => {
  const messages = [...initialMessages];
  const allUsedChunks = [];

  const initialChunks = await searchKnowledgeChunksByVector(currentMessage, candidateChunks, retrievalPolicy, process.env, searchKnowledgeChunks);
  if (initialChunks.length > 0) {
    allUsedChunks.push(...initialChunks);
    const block = initialChunks
      .map((chunk, i) => `资料${i + 1}（${chunk.documentTitle || chunk.sourceType || '知识片段'}）：${chunk.content}`)
      .join('\n\n');
    messages.splice(messages.length - 1, 0, {
      role: 'system',
      content: `以下是初步检索到的相关知识库内容：\n${block}`,
    });
    const docTitles = [...new Set(initialChunks.map((c) => c.documentTitle || c.sourceType || '知识片段').filter(Boolean))];
    onProgress?.({ stage: 'retrieved', round: 0, queries: [], chunkCount: initialChunks.length, docTitles });
  }

  let extraRounds = 0;
  while (extraRounds <= maxExtraRounds) {
    onProgress?.({ stage: 'thinking', round: extraRounds + 1 });
    const output = await executeProviderJobWithManagedAssetScrub({
      userId,
      taskType: 'kie_chat',
      payload: { messages, model: selectedModel, fallbackModels, reasoningLevel, webSearchEnabled },
    }, process.env, new AbortController().signal);

    const rawContent = String(output?.result?.content || '').trim();
    const toolCalls = parseAgentToolCalls(rawContent);

    if (!toolCalls.length || extraRounds === maxExtraRounds) {
      return { content: stripAgentToolCalls(rawContent), allUsedChunks };
    }

    messages.push({ role: 'assistant', content: rawContent });

    const queries = toolCalls.map((c) => c.query);
    let roundNewChunkCount = 0;
    const roundDocTitles = [];
    for (const call of toolCalls) {
      const chunks = await searchKnowledgeChunksByVector(call.query, candidateChunks, retrievalPolicy, process.env, searchKnowledgeChunks);
      const newChunks = chunks.filter((c) => !allUsedChunks.some((u) => u.id === c.id));
      allUsedChunks.push(...newChunks);
      roundNewChunkCount += newChunks.length;
      for (const c of newChunks) {
        const t = c.documentTitle || c.sourceType || '知识片段';
        if (t && !roundDocTitles.includes(t)) roundDocTitles.push(t);
      }
      const resultContent = newChunks.length > 0
        ? `[SEARCH: ${call.query}] 检索结果：\n` + newChunks.map((c, i) => `资料${i + 1}（${c.documentTitle || c.sourceType}）：${c.content}`).join('\n\n')
        : `[SEARCH: ${call.query}] 未找到相关内容。`;
      messages.push({ role: 'user', content: resultContent });
    }
    onProgress?.({ stage: 'retrieved', round: extraRounds + 1, queries, chunkCount: roundNewChunkCount, docTitles: roundDocTitles });

    extraRounds += 1;
  }

  return { content: '', allUsedChunks };
};

const runAgentConversation = async ({
  user,
  agent,
  version,
  priorMessages,
  currentMessage,
  sessionId = null,
  selectedModelOverride = '',
  attachments = [],
  reasoningLevel = null,
  webSearchEnabled = false,
  onProgress = null,
}) => {
  const shouldRetrieve = shouldUseKnowledgeRetrieval(currentMessage, version.retrievalPolicy, version.knowledgeBaseIds);
  const hasKnowledgeBase = Array.isArray(version.knowledgeBaseIds) && version.knowledgeBaseIds.length > 0 && Boolean(version.retrievalPolicy?.enabled);
  const candidateChunks = (shouldRetrieve || hasKnowledgeBase) ? await listDbKnowledgeChunksForVersion(version) : [];
  const allPrior = Array.isArray(priorMessages) ? priorMessages : [];
  const selectedModel = String(selectedModelOverride || (hasKnowledgeBase ? version.modelPolicy.defaultModel : version.modelPolicy.cheapModel) || '').trim();
  const fallbackModels = resolveChatFallbackModels(version, selectedModel);
  const ctxLimits = resolveContextLimits({
    modelId: selectedModel,
    contextPolicy: version.contextPolicy || {},
  });
  const maxRounds = ctxLimits.maxHistoryRounds;
  const summaryThreshold = ctxLimits.summaryTriggerThreshold;
  const recentCount = maxRounds * 2;
  let summary = '';
  let recentSlice = allPrior;
  if (allPrior.length > summaryThreshold * 2) {
    const olderMessages = allPrior.slice(0, -recentCount);
    summary = buildConversationSummary(olderMessages, ctxLimits.maxSummaryChars);
    onProgress?.({ stage: 'compressed', foldedRounds: olderMessages.length });
    recentSlice = allPrior.slice(-recentCount);
  } else {
    recentSlice = allPrior.slice(-recentCount);
  }
  const recentMessages = recentSlice.map((message) => ({
    role: message.role,
    content: Array.isArray(message.attachments) && message.attachments.length > 0
      ? buildChatMessageContent(message.content, message.attachments.filter((a) => a?.kind === 'image'))
      : message.content,
  }));
  const linkedInterfaces = Array.isArray(version.toolPolicy?.linkedModuleInterfaces)
    ? version.toolPolicy.linkedModuleInterfaces
    : [];
  const interfaceOutputSpecs = linkedInterfaces
    .map((id) => MODULE_INTERFACES[id]?.outputSpec)
    .filter(Boolean)
    .join('\n\n');
  const effectiveSystemPrompt = interfaceOutputSpecs
    ? `${version.systemPrompt}\n\n${interfaceOutputSpecs}`.trim()
    : version.systemPrompt;
  const pool = await getMysqlPool();
  const { text: inlinedMessage, attachments: remainingAttachments } = await inlineTextAttachments(pool, currentMessage, attachments);
  const messages = buildAgentPromptMessages({
    systemPrompt: effectiveSystemPrompt,
    summary,
    recentMessages,
    knowledgeChunks: [],
    userMessage: inlinedMessage,
    hasKnowledgeBase,
  });
  if (messages.length > 0) {
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: buildChatMessageContent(inlinedMessage, remainingAttachments),
    };
  }
  const startedAt = Date.now();
  let content;
  let usedChunks = [];
  let output = null;
  if (hasKnowledgeBase) {
    const agenticResult = await runAgenticRetrievalLoop({
      userId: user.id,
      initialMessages: messages,
      currentMessage,
      selectedModel,
      fallbackModels,
      reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
      webSearchEnabled: Boolean(webSearchEnabled),
      candidateChunks,
      retrievalPolicy: version.retrievalPolicy,
      onProgress,
    });
    content = sanitizeAgentAssistantContent(agenticResult.content);
    usedChunks = agenticResult.allUsedChunks;
  } else {
    onProgress?.({ stage: 'thinking', round: 1 });
    output = await executeProviderJobWithManagedAssetScrub({
      userId: user.id,
      taskType: 'kie_chat',
      payload: {
        messages,
        model: selectedModel,
        fallbackModels,
        reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
        webSearchEnabled: Boolean(webSearchEnabled),
        maxTokens: ctxLimits.maxOutputTokens,
      },
    }, process.env, new AbortController().signal);
    content = sanitizeAgentAssistantContent(output?.result?.content);
  }
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(content);
  const latencyMs = Date.now() - startedAt;
  const estimatedCost = estimateCostByTokens(promptTokens, completionTokens);
  const actualModel = String(output?.result?.modelUsed || selectedModel || '').trim() || selectedModel;
  const fallbackFrom = output?.result?.fallbackFrom ? String(output.result.fallbackFrom) : null;
  return {
    content,
    selectedModel: actualModel,
    fallbackFrom,
    usedRetrieval: usedChunks.length > 0,
    knowledgeChunks: usedChunks,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs,
    estimatedCost,
    retrievalSummary: usedChunks.map((chunk) => ({
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      preview: String(chunk.content || '').slice(0, 120),
    })),
    sessionId,
    userId: user.id,
    agentId: agent.id,
  };
};

const validateDbAgentVersion = async (user, versionId, message) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const result = await runAgentConversation({
    user,
    agent,
    version,
    priorMessages: [],
    currentMessage: String(message || '请用一句话说明这个智能体能做什么。'),
  });
  const pool = await getMysqlPool();
  const validationSummary = {
    ...result,
    outputPreview: result.content.slice(0, 300),
    validatedAt: Date.now(),
  };
  await pool.query(
    'UPDATE agent_versions SET validation_status = ?, validation_summary_json = ? WHERE id = ?',
    ['success', JSON.stringify(validationSummary), versionId]
  );
  return {
    version: await getDbAgentVersionById(versionId),
    result: validationSummary,
  };
};

const publishDbAgentVersion = async (user, agentId, versionId = null) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const versions = await listDbAgentVersionsByAgentId(agentId);
  const targetVersion = versionId
    ? versions.find((item) => item.id === versionId)
    : versions.find((item) => !item.isPublished) || versions[0];
  if (!targetVersion || targetVersion.validationStatus !== 'success') return null;
  const pool = await getMysqlPool();
  await pool.query('UPDATE agent_versions SET is_published = 0 WHERE agent_id = ?', [agentId]);
  await pool.query('UPDATE agent_versions SET is_published = 1 WHERE id = ?', [targetVersion.id]);
  await pool.query(
    'UPDATE agents SET current_version_id = ?, status = ?, updated_at = ? WHERE id = ?',
    [targetVersion.id, 'published', Date.now(), agentId]
  );
  return await getDbAgentById(agentId);
};

const rollbackDbAgentVersion = async (user, agentId, versionId) => {
  return publishDbAgentVersion(user, agentId, versionId);
};

const listDbChatAgents = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT a.*, av.version_no, av.model_policy_json, av.allowed_chat_models_json, av.default_chat_model
     FROM agents a
     INNER JOIN agent_versions av ON av.id = a.current_version_id
     WHERE a.status = ? AND a.current_version_id IS NOT NULL
     ORDER BY a.updated_at DESC`,
    ['published']
  );
  return rows.map((row) => {
    const rawModelPolicy = parseJsonField(row.model_policy_json, {});
    const allowedChatModels = sanitizeAllowedChatModels(parseJsonField(row.allowed_chat_models_json, []), [
      row.default_chat_model,
      rawModelPolicy.defaultModel,
      rawModelPolicy.cheapModel,
    ]);
    const modelPolicy = sanitizeModelPolicy(rawModelPolicy, allowedChatModels);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      department: row.department,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: '',
      visibilityScope: row.visibility_scope,
      status: row.status,
      currentVersionId: row.current_version_id,
      currentVersionNo: Number(row.version_no || 1),
      defaultModel: modelPolicy.defaultModel || '',
      allowedChatModels,
      defaultChatModel: allowedChatModels.includes(String(row.default_chat_model || '').trim())
        ? String(row.default_chat_model).trim()
        : modelPolicy.defaultModel || '',
      imageGenerationEnabled: Boolean(modelPolicy.imageGenerationEnabled),
      imageModel: modelPolicy.multimodalModel || '',
      imageMaxInputCount: Number(getImageModelCapability(modelPolicy.multimodalModel)?.maxInputImages || 1),
      iconUrl: row.icon_url || '',
      avatarPreset: row.avatar_preset || '',
      knowledgeBaseCount: 0,
      usageCount7d: 0,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  });
};

const createDbChatSession = async (user, agentId) => {
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let agentLockName = '';
  let userLockName = '';
  try {
    agentLockName = await acquireManagedAssetAgentLock(connection, agentId);
    userLockName = await acquireManagedAssetUserLock(connection, user.id);
    const [ownerRows] = await connection.query('SELECT status FROM users WHERE id = ? LIMIT 1', [user.id]);
    if (!ownerRows?.[0] || ownerRows[0].status !== 'active') return null;
    const agent = await getDbAgentById(agentId);
    if (!agent?.currentVersionId || agent.status !== 'published') return null;
    const version = await getDbAgentVersionById(agent.currentVersionId);
    const selectedModel = resolveChatSessionModel(version);
    const capability = getChatModelCapability(selectedModel, getPersistentAssetBaseUrl());
    const defaultReasoningLevel = resolveSessionReasoningLevel({ capability, requestedReasoningLevel: null });
    const sessionId = createEntityId();
    const now = Date.now();
    await connection.query(
      `INSERT INTO chat_sessions (id, user_id, agent_id, agent_version_id, title, status, summary, selected_model, reasoning_level, web_search_enabled, last_image_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, agentId, agent.currentVersionId, '新会话', 'active', null, selectedModel || '', defaultReasoningLevel, 0, 0, now, now]
    );
    return {
      id: sessionId,
      userId: user.id,
      agentId,
      agentVersionId: agent.currentVersionId,
      title: '新会话',
      status: 'active',
      summary: '',
      selectedModel: selectedModel || '',
      reasoningLevel: defaultReasoningLevel,
      webSearchEnabled: false,
      lastImageMode: false,
      createdAt: now,
      updatedAt: now,
    };
  } finally {
    if (userLockName) await releaseManagedAssetUserLock(connection, userLockName).catch(() => null);
    if (agentLockName) await releaseManagedAssetUserLock(connection, agentLockName).catch(() => null);
    connection.release();
  }
};

const listDbChatSessions = async (user, agentId = '') => {
  const pool = await getMysqlPool();
  const clauses = ['user_id = ?', '(is_studio IS NULL OR is_studio = 0)'];
  const values = [user.id];
  if (agentId) {
    clauses.push('agent_id = ?');
    values.push(agentId);
  }
  const [rows] = await pool.query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id AND m.user_id = s.user_id) AS message_count,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id AND m.user_id = s.user_id AND (m.attachments_json LIKE '%"kind":"image"%' OR m.metadata_json LIKE '%"imageResultUrls"%')) AS image_count,
       (SELECT LEFT(m.content, 120) FROM chat_messages m WHERE m.session_id = s.id AND m.user_id = s.user_id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
       (SELECT JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json, '$.status')) FROM chat_messages m WHERE m.session_id = s.id AND m.user_id = s.user_id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1) AS last_run_status
     FROM chat_sessions s
     WHERE ${clauses.map((clause) => clause.replace(/\buser_id\b/g, 's.user_id').replace(/\bagent_id\b/g, 's.agent_id').replace(/\bis_studio\b/g, 's.is_studio')).join(' AND ')}
     ORDER BY s.updated_at DESC`,
    values
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    title: row.title,
    status: row.status,
    summary: row.summary || '',
    selectedModel: row.selected_model || '',
    reasoningLevel: row.reasoning_level || null,
    webSearchEnabled: Boolean(row.web_search_enabled),
    lastImageMode: Boolean(row.last_image_mode),
    messageCount: Number(row.message_count || 0),
    imageCount: Number(row.image_count || 0),
    lastMessagePreview: row.last_message_preview || '',
    lastRunStatus: row.last_run_status || '',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
};

const getDbChatSessionById = async (user, sessionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ? LIMIT 1', [sessionId, user.id]);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    agentId: rows[0].agent_id,
    agentVersionId: rows[0].agent_version_id,
    title: rows[0].title,
    status: rows[0].status,
    summary: rows[0].summary || '',
    selectedModel: rows[0].selected_model || '',
    reasoningLevel: rows[0].reasoning_level || null,
    webSearchEnabled: Boolean(rows[0].web_search_enabled),
    lastImageMode: Boolean(rows[0].last_image_mode),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const mapDbChatMessageRow = (row) => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  role: row.role,
  content: row.content,
  attachments: parseJsonField(row.attachments_json, null),
  metadata: parseJsonField(row.metadata_json, null),
  createdAt: Number(row.created_at),
});

const listDbChatMessages = async (user, sessionId) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return [];
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM chat_messages WHERE session_id = ? AND user_id = ? ORDER BY created_at ASC',
    [sessionId, user.id]
  );
  const messages = rows.map(mapDbChatMessageRow);
  if (await recoverDbSubmittedChatImageTasks(user, sessionId, messages)) {
    const [nextRows] = await pool.query(
      'SELECT * FROM chat_messages WHERE session_id = ? AND user_id = ? ORDER BY created_at ASC',
      [sessionId, user.id]
    );
    return nextRows.map(mapDbChatMessageRow);
  }
  return messages;
};

const findDbChatExchangeByClientRequestId = async (user, sessionId, clientRequestId) => {
  const normalizedRequestId = String(clientRequestId || '').trim();
  if (!normalizedRequestId) return null;
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT * FROM chat_messages
     WHERE session_id = ?
       AND user_id = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.clientRequestId')) = ?
     ORDER BY created_at ASC`,
    [sessionId, user.id, normalizedRequestId]
  );
  const messages = rows.map(mapDbChatMessageRow);
  const userMessage = messages.find((message) => message.role === 'user') || null;
  const assistantMessage = messages.find((message) => message.role === 'assistant') || null;
  if (!userMessage || !assistantMessage) return null;
  return {
    userMessage,
    assistantMessage,
    usage: {
      idempotent: true,
      clientRequestId: normalizedRequestId,
      selectedModel: assistantMessage.metadata?.selectedModel || userMessage.metadata?.selectedModel || '',
      requestType: assistantMessage.metadata?.requestMode || userMessage.metadata?.requestMode || 'chat',
      sessionId,
    },
  };
};

const createDbAgentUsageLog = async (user, agent, version, result, status, errorMessage = '') => {
  const pool = await getMysqlPool();
  const createdAt = Date.now();
  await pool.query(
    `INSERT INTO agent_usage_logs (
      id, user_id, username, display_name, agent_id, agent_name, agent_version_id, session_id,
      request_type, selected_model, used_retrieval, retrieval_summary_json, prompt_tokens,
      completion_tokens, total_tokens, estimated_cost, latency_ms, status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createEntityId(),
      user.id,
      user.username,
      user.displayName || user.username,
      agent.id,
      agent.name,
      version.id,
      result?.sessionId || null,
      result?.requestType || (result?.sessionId ? 'chat' : 'validation'),
      result?.selectedModel || version.modelPolicy.defaultModel,
      result?.usedRetrieval ? 1 : 0,
      JSON.stringify(result?.retrievalSummary || []),
      Number(result?.promptTokens || 0),
      Number(result?.completionTokens || 0),
      Number(result?.totalTokens || 0),
      Number(result?.estimatedCost || 0),
      Number(result?.latencyMs || 0),
      status,
      errorMessage || null,
      createdAt,
    ]
  );
  await createDbLog({
    user,
    level: status === 'success' ? 'info' : 'error',
    module: 'agent_center',
    action: result?.requestType === 'image_generation' ? 'create_image_task' : result?.sessionId ? 'agent_chat' : 'agent_validate',
    message: `${result?.requestType === 'image_generation' ? '智能体生图' : result?.sessionId ? '智能体对话' : '智能体验证'}：${agent.name}`,
    detail: errorMessage || '',
    status: status === 'success' ? 'success' : 'failed',
    meta: buildAgentRuntimeLogMeta({ agent, version, result, error: errorMessage ? { message: errorMessage } : null }),
  });
};

const createDbChatSessionOptions = async (user, sessionId, payload) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const version = await getDbAgentVersionById(session.agentVersionId);
  if (!version) return null;
  const publicBaseUrl = getPersistentAssetBaseUrl();
  const selectedModel = resolveChatSessionModel(version, payload?.selectedModel || session.selectedModel);
  const capability = getChatModelCapability(selectedModel, publicBaseUrl);
  const requestedReasoningLevel = Object.prototype.hasOwnProperty.call(payload || {}, 'reasoningLevel')
    ? payload?.reasoningLevel
    : session.reasoningLevel;
  const nextReasoningLevel = resolveSessionReasoningLevel({ capability, requestedReasoningLevel });
  const nextWebSearchEnabled = capability?.supportsWebSearch ? Boolean(payload?.webSearchEnabled) : false;
  const nextLastImageMode = Boolean(payload?.lastImageMode);
  const pool = await getMysqlPool();
  await pool.query(
    'UPDATE chat_sessions SET selected_model = ?, reasoning_level = ?, web_search_enabled = ?, last_image_mode = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [selectedModel || '', nextReasoningLevel, nextWebSearchEnabled ? 1 : 0, nextLastImageMode ? 1 : 0, Date.now(), sessionId, user.id]
  );
  return await getDbChatSessionById(user, sessionId);
};

const deleteDbChatSession = async (user, sessionId) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let agentLockName = '';
  let lockName = '';
  let transactionStarted = false;
  try {
    agentLockName = await acquireManagedAssetAgentLock(connection, session.agentId);
    lockName = await acquireManagedAssetUserLock(connection, user.id);
    await assertNoPendingDbAgentChatRuns(connection, { sessionId, userId: user.id });
    await connection.beginTransaction();
    transactionStarted = true;
    const [messages] = await connection.query(
      'SELECT * FROM chat_messages WHERE session_id = ? AND user_id = ? FOR UPDATE',
      [sessionId, user.id],
    );
    const assetIds = collectStoredAssetIdsFromChatMessages(messages);
    await connection.query('DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?', [sessionId, user.id]);
    await connection.query('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
    const cleanup = await queueStoredAssetsAfterReferenceRemoval({
      pool: connection,
      assetIds,
      reason: 'chat_session_deleted',
      ownerUserId: user.id,
    });
    await connection.commit();
    transactionStarted = false;
    return { ok: true, deletedSessionId: sessionId, deletedAssetIds: cleanup.deletedAssetIds };
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    if (lockName) {
      await releaseManagedAssetUserLock(connection, lockName).catch(() => null);
    }
    if (agentLockName) {
      await releaseManagedAssetUserLock(connection, agentLockName).catch(() => null);
    }
    connection.release();
  }
};

const deleteDbUserAgentHistory = async (user, agentId) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || agent.status !== 'published') return null;
  const lockPool = await getManagedAssetLockPool();
  const connection = await lockPool.getConnection();
  let agentLockName = '';
  let lockName = '';
  let transactionStarted = false;
  try {
    agentLockName = await acquireManagedAssetAgentLock(connection, agentId);
    lockName = await acquireManagedAssetUserLock(connection, user.id);
    await assertNoPendingDbAgentChatRuns(connection, { agentIds: [agentId], userId: user.id });
    await connection.beginTransaction();
    transactionStarted = true;
    const [historyMessages] = await connection.query(
      `SELECT message.*
       FROM chat_messages message
       INNER JOIN chat_sessions session ON session.id = message.session_id
       WHERE session.user_id = ? AND session.agent_id = ?
       FOR UPDATE`,
      [user.id, agentId],
    );
    const historyAssetIds = collectStoredAssetIdsFromChatMessages(historyMessages);
    const [messageResult] = await connection.query(
      `DELETE message FROM chat_messages message
       INNER JOIN chat_sessions session ON session.id = message.session_id
       WHERE session.user_id = ? AND session.agent_id = ?`,
      [user.id, agentId],
    );
    const [sessionResult] = await connection.query('DELETE FROM chat_sessions WHERE user_id = ? AND agent_id = ?', [user.id, agentId]);
    const [usageResult] = await connection.query('DELETE FROM agent_usage_logs WHERE user_id = ? AND agent_id = ?', [user.id, agentId]);
    const cleanup = await queueStoredAssetsAfterReferenceRemoval({
      pool: connection,
      assetIds: historyAssetIds,
      reason: 'agent_chat_history_deleted',
      ownerUserId: user.id,
    });
    await connection.commit();
    transactionStarted = false;
    return {
      ok: true,
      deletedSessionCount: Number(sessionResult.affectedRows || 0),
      deletedMessageCount: Number(messageResult.affectedRows || 0),
      deletedUsageCount: Number(usageResult.affectedRows || 0),
      deletedAssetIds: cleanup.deletedAssetIds,
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    if (lockName) {
      await releaseManagedAssetUserLock(connection, lockName).catch(() => null);
    }
    if (agentLockName) {
      await releaseManagedAssetUserLock(connection, agentLockName).catch(() => null);
    }
    connection.release();
  }
};

// 进度状态 Map，key = clientRequestId，value = 最新进度事件，5分钟后自动清理
const chatProgressMap = new Map();
const setChatProgress = (clientRequestId, progress) => {
  if (!clientRequestId) return;
  chatProgressMap.set(clientRequestId, { ...progress, ts: Date.now() });
  setTimeout(() => chatProgressMap.delete(clientRequestId), 5 * 60 * 1000);
};

const activeDbChatReplyRequests = new Map();
const activeLocalChatReplyRequests = new Map();
const buildChatRequestKey = (sessionId, clientRequestId) => `${sessionId || ''}:${clientRequestId || ''}`;
const isAgentChatRunPendingMetadata = (metadata) => {
  const status = String(metadata?.status || '').trim().toLowerCase();
  return Boolean(metadata?.pending) || status === 'pending' || status === 'running';
};
const getManagedAssetAgentBusyLeaseMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_ASSET_AGENT_BUSY_LEASE_MS ?? 2 * 60 * 60 * 1000), 10);
  return Number.isFinite(parsed)
    ? Math.max(5 * 60 * 1000, Math.min(parsed, 24 * 60 * 60 * 1000))
    : 2 * 60 * 60 * 1000;
};
const assertNoPendingDbAgentChatRuns = async (connection, { agentIds = [], sessionId = '', userId = '' } = {}) => {
  const normalizedAgentIds = Array.from(new Set(
    (agentIds || []).map((value) => String(value || '').trim()).filter(Boolean),
  ));
  const clauses = [
    "message.role = 'assistant'",
    'message.created_at >= ?',
    `(JSON_UNQUOTE(JSON_EXTRACT(message.metadata_json, '$.pending')) = 'true'
      OR JSON_UNQUOTE(JSON_EXTRACT(message.metadata_json, '$.status')) IN ('pending', 'running'))`,
  ];
  const values = [Date.now() - getManagedAssetAgentBusyLeaseMs()];
  if (normalizedAgentIds.length > 0) {
    clauses.push(`session.agent_id IN (${normalizedAgentIds.map(() => '?').join(', ')})`);
    values.push(...normalizedAgentIds);
  }
  if (sessionId) {
    clauses.push('session.id = ?');
    values.push(sessionId);
  }
  if (userId) {
    clauses.push('session.user_id = ?');
    values.push(userId);
  }
  if (normalizedAgentIds.length === 0 && !sessionId) return;
  const [rows] = await connection.query(
    `SELECT message.id
     FROM chat_messages message
     INNER JOIN chat_sessions session ON session.id = message.session_id
     WHERE ${clauses.join(' AND ')}
     LIMIT 1`,
    values,
  );
  if (rows?.[0]) {
    const error = new Error('智能体仍有对话任务处理中，请等待完成后重试删除');
    error.code = 'managed_asset_agent_busy';
    error.statusCode = 409;
    throw error;
  }
};
const getAgentChatClientRequestId = (message) => String(message?.metadata?.clientRequestId || '').trim();
const buildPendingAgentChatContent = (requestMode) => (
  requestMode === 'image_generation' ? '需求分析中' : '思考中'
);
const buildAgentImageResultAttachments = (imageResultUrls) => (
  Array.isArray(imageResultUrls) && imageResultUrls.length > 0
    ? imageResultUrls.map((url, index) => ({
        name: `生成结果${index + 1}`,
        url: String(url || ''),
        kind: 'image',
      }))
    : null
);
const shouldRecoverSubmittedChatImageTask = (message) => {
  const metadata = message?.metadata || {};
  const providerTaskId = String(metadata.providerTaskId || metadata.imagePlan?.providerTaskId || '').trim();
  if (!providerTaskId) return false;
  if (metadata.checkpoint !== 'image_task_submitted') return false;
  if (Array.isArray(metadata.imageResultUrls) && metadata.imageResultUrls.length > 0) return false;
  if (!isAgentChatRunPendingMetadata(metadata)) return false;
  const lastCheckedAt = Number(metadata.recoveryCheckedAt || 0);
  return !lastCheckedAt || Date.now() - lastCheckedAt >= 10_000;
};
const buildRecoveredChatImageMetadata = ({ metadata = {}, imageUrl = '', providerTaskId = '', providerStatus = '' }) => ({
  ...metadata,
  status: 'completed',
  phase: 'completed',
  pending: false,
  progress: false,
  progressStage: 'image_ready',
  imagePlan: {
    ...(metadata.imagePlan || {}),
    providerTaskId,
  },
  imageResultUrls: [imageUrl],
  providerTaskId,
  providerStatus: providerStatus || 'success',
  checkpoint: 'image_task_recovered',
  recoveredAt: Date.now(),
});
const recoverDbSubmittedChatImageTasks = async (user, sessionId, messages = []) => {
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((message) => message.role === 'assistant' && shouldRecoverSubmittedChatImageTask(message));
  if (candidates.length === 0) return false;
  const pool = await getMysqlPool();
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return false;
  let recovered = false;
  for (const message of candidates) {
    const metadata = message.metadata || {};
    const providerTaskId = String(metadata.providerTaskId || metadata.imagePlan?.providerTaskId || '').trim();
    try {
      const output = await executeProviderJobWithManagedAssetScrub({
        taskType: 'kie_probe',
        payload: { providerTaskId, isVideo: false },
      }, process.env, new AbortController().signal);
      const rawUrl = String(output?.result?.imageUrl || '').trim();
      if (!rawUrl) {
        await pool.query(
          'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [JSON.stringify({ ...metadata, recoveryCheckedAt: Date.now(), providerStatus: output?.providerStatus || 'pending' }), message.id, sessionId, user.id]
        );
        continue;
      }
      const persistedUrl = await persistRuntimeRemoteAssetIfEnabled({
        userId: user.id,
        moduleName: 'agent_center',
        assetType: 'result',
        remoteUrl: rawUrl,
        originalName: `${providerTaskId || 'image_result'}.png`,
        provider: 'kie',
        jobId: normalizeStoredAssetJobId(providerTaskId),
      });
      const imageUrl = persistedUrl || rawUrl;
      const assistantMetadata = buildRecoveredChatImageMetadata({
        metadata,
        imageUrl,
        providerTaskId,
        providerStatus: output?.providerStatus || 'success',
      });
      const now = Date.now();
      const lockPool = await getManagedAssetLockPool();
      const lockConnection = await lockPool.getConnection();
      let connection = null;
      let agentLockName = '';
      let userLockName = '';
      try {
        agentLockName = await acquireManagedAssetAgentLock(lockConnection, session.agentId);
        userLockName = await acquireManagedAssetUserLock(lockConnection, user.id);
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [activeSessionRows] = await connection.query(
          `SELECT session.id
           FROM chat_sessions session
           INNER JOIN agents agent ON agent.id = session.agent_id
           INNER JOIN users owner ON owner.id = session.user_id AND owner.status = 'active'
           WHERE session.id = ? AND session.user_id = ? AND session.agent_id = ?
           LIMIT 1`,
          [sessionId, user.id, session.agentId],
        );
        if (!activeSessionRows?.[0]) {
          const error = new Error('智能体或会话已被删除，未写入恢复结果');
          error.code = 'managed_asset_chat_session_unavailable';
          error.statusCode = 409;
          throw error;
        }
        const [messageUpdate] = await connection.query(
          'UPDATE chat_messages SET content = ?, attachments_json = ?, metadata_json = ?, created_at = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [
            '图片已生成完成。',
            JSON.stringify(buildAgentImageResultAttachments([imageUrl])),
            JSON.stringify(assistantMetadata),
            now,
            message.id,
            sessionId,
            user.id,
          ]
        );
        if (Number(messageUpdate?.affectedRows || 0) !== 1) {
          const error = new Error('会话已被删除，未写入恢复结果');
          error.code = 'managed_asset_chat_session_unavailable';
          error.statusCode = 409;
          throw error;
        }
        const clientRequestId = String(metadata.clientRequestId || '').trim();
        if (clientRequestId) {
          await connection.query(
            `UPDATE chat_messages
             SET metadata_json = JSON_SET(metadata_json, '$.status', 'completed', '$.pending', false, '$.phase', 'submitted')
             WHERE session_id = ? AND user_id = ? AND role = 'user'
               AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.clientRequestId')) = ?`,
            [sessionId, user.id, clientRequestId]
          );
        }
        await connection.query('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [now, sessionId]);
        await connection.commit();
        recovered = true;
      } catch (error) {
        if (connection) await connection.rollback().catch(() => null);
        throw error;
      } finally {
        if (userLockName) {
          await releaseManagedAssetUserLock(lockConnection, userLockName).catch(() => null);
        }
        if (agentLockName) {
          await releaseManagedAssetUserLock(lockConnection, agentLockName).catch(() => null);
        }
        connection?.release();
        lockConnection.release();
      }
    } catch (error) {
      await pool.query(
        'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
        [JSON.stringify({ ...metadata, recoveryCheckedAt: Date.now(), providerStatus: error?.providerStatus || 'recover_probe_failed', providerMessage: error?.message || String(error || '') }), message.id, sessionId, user.id]
      ).catch(() => {});
    }
  }
  return recovered;
};
const recoverLocalSubmittedChatImageTasks = async (store, user, sessionId, messages = []) => {
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((message) => message.role === 'assistant' && shouldRecoverSubmittedChatImageTask(message));
  if (candidates.length === 0) return false;
  let recovered = false;
  let changed = false;
  for (const message of candidates) {
    const metadata = message.metadata || {};
    const providerTaskId = String(metadata.providerTaskId || metadata.imagePlan?.providerTaskId || '').trim();
    try {
      const output = await executeProviderJobWithManagedAssetScrub({
        taskType: 'kie_probe',
        payload: { providerTaskId, isVideo: false },
      }, process.env, new AbortController().signal);
      const rawUrl = String(output?.result?.imageUrl || '').trim();
      const targetMessage = (store.chatMessages || []).find((item) => item.id === message.id && item.sessionId === sessionId && item.userId === user.id);
      if (!targetMessage) continue;
      if (!rawUrl) {
        targetMessage.metadata = {
          ...(targetMessage.metadata || metadata),
          recoveryCheckedAt: Date.now(),
          providerStatus: output?.providerStatus || 'pending',
        };
        changed = true;
        continue;
      }
      const persistedUrl = await persistRuntimeRemoteAssetIfEnabled({
        userId: user.id,
        moduleName: 'agent_center',
        assetType: 'result',
        remoteUrl: rawUrl,
        originalName: `${providerTaskId || 'image_result'}.png`,
        provider: 'kie',
        jobId: normalizeStoredAssetJobId(providerTaskId),
      });
      const imageUrl = persistedUrl || rawUrl;
      targetMessage.content = '图片已生成完成。';
      targetMessage.attachments = buildAgentImageResultAttachments([imageUrl]);
      targetMessage.metadata = buildRecoveredChatImageMetadata({
        metadata: targetMessage.metadata || metadata,
        imageUrl,
        providerTaskId,
        providerStatus: output?.providerStatus || 'success',
      });
      targetMessage.createdAt = Date.now();
      const clientRequestId = String(metadata.clientRequestId || '').trim();
      if (clientRequestId) {
        (store.chatMessages || [])
          .filter((item) => item.sessionId === sessionId && item.userId === user.id && item.role === 'user' && String(item.metadata?.clientRequestId || '').trim() === clientRequestId)
          .forEach((item) => {
            item.metadata = {
              ...(item.metadata || {}),
              status: 'completed',
              pending: false,
              phase: 'submitted',
            };
          });
      }
      const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
      if (session) session.updatedAt = Date.now();
      recovered = true;
      changed = true;
    } catch (error) {
      const targetMessage = (store.chatMessages || []).find((item) => item.id === message.id && item.sessionId === sessionId && item.userId === user.id);
      if (targetMessage) {
        targetMessage.metadata = {
          ...(targetMessage.metadata || metadata),
          recoveryCheckedAt: Date.now(),
          providerStatus: error?.providerStatus || 'recover_probe_failed',
          providerMessage: error?.message || String(error || ''),
        };
        changed = true;
      }
    }
  }
  if (changed) writeLocalStore(store);
  return recovered;
};
const buildActiveAgentChatRunError = () => {
  const error = new Error('当前会话已有任务处理中，请等待完成后再发送新任务。');
  error.code = 'agent_chat_run_active';
  error.statusCode = 409;
  return error;
};
const findPendingDbChatRunForSession = async (user, sessionId, excludeClientRequestId = '') => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT * FROM chat_messages
     WHERE session_id = ? AND user_id = ? AND role = 'assistant'
     ORDER BY created_at DESC
     LIMIT 30`,
    [sessionId, user.id]
  );
  return rows
    .map(mapDbChatMessageRow)
    .find((message) => (
      isAgentChatRunPendingMetadata(message.metadata)
      && getAgentChatClientRequestId(message) !== String(excludeClientRequestId || '').trim()
    )) || null;
};
const sanitizeAgentAssistantContent = (content) =>
  String(content || '')
    .replace(/(^|\n)\s*final_answer\s*(?=\n|$)/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const createDbChatReply = async (user, sessionId, payload, sendEvent = null) => {
  const content = String(payload?.content || '').trim();
  const requestMode = payload?.requestMode === 'image_generation' ? 'image_generation' : 'chat';
  const clientRequestId = String(payload?.clientRequestId || createEntityId()).trim() || createEntityId();
  const runId = `run-${clientRequestId}`;
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const activeKey = buildChatRequestKey(sessionId, clientRequestId);
  if (activeDbChatReplyRequests.has(activeKey)) return activeDbChatReplyRequests.get(activeKey);
  const existingExchange = await findDbChatExchangeByClientRequestId(user, sessionId, clientRequestId);
  if (existingExchange && !isAgentChatRunPendingMetadata(existingExchange.assistantMessage?.metadata)) return existingExchange;
  const activeSessionRun = await findPendingDbChatRunForSession(user, sessionId, clientRequestId);
  if (activeSessionRun) throw buildActiveAgentChatRunError();
  if (existingExchange) return existingExchange;

  const promise = (async () => {
  const pool = await getMysqlPool();
  const version = await getDbAgentVersionById(session.agentVersionId);
  const agent = await getDbAgentById(session.agentId);
  if (!version || !agent) return null;
  const publicBaseUrl = getPersistentAssetBaseUrl();
  const selectedModel = resolveChatSessionModel(version, payload?.selectedModel || session.selectedModel);
  const capability = getChatModelCapability(selectedModel, publicBaseUrl);
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments.map((item) => ({
    name: String(item?.name || '').trim() || '附件',
    url: item?.url ? String(item.url) : undefined,
    assetId: item?.assetId ? String(item.assetId) : undefined,
    mimeType: item?.mimeType ? String(item.mimeType) : undefined,
    kind: item?.kind === 'image' ? 'image' : 'file',
  })) : [];
  await assertOwnedActiveManagedAssetReferences({
    value: attachments,
    userId: user.id,
    pool,
  });
  if (requestMode === 'image_generation' && attachments.some((item) => item.kind !== 'image')) {
    throw new Error('生图模式暂只支持上传图片');
  }
  const capabilityError = getAttachmentCapabilityError({ capability, attachments, requestMode, modelLabel: `模型 ${selectedModel} ` });
  if (capabilityError) throw new Error(capabilityError);
  if (requestMode !== 'image_generation' && payload?.webSearchEnabled && !capability?.supportsWebSearch) {
    throw new Error('当前模型不支持联网');
  }
  const now = Date.now();
  const userMessageId = createEntityId();
  const assistantMessageId = createEntityId();
  const history = await listDbChatMessages(user, sessionId);
  const summaryNeeded = history.filter((item) => item.role !== 'system').length > Number(version.contextPolicy.summaryTriggerThreshold || 10);
  const summary = summaryNeeded ? buildConversationSummary(history, Number(version.contextPolicy.maxSummaryChars || 1200)) : (session.summary || '');
  const systemSettings = getUserScopedSystemSettings(await getDbSystemSettings(), user);
  const imageKnowledgeChunks = requestMode === 'image_generation' && version.retrievalPolicy?.enabled
    ? await searchKnowledgeChunksByVector(content, await listDbKnowledgeChunksForVersion(version), {
        ...version.retrievalPolicy,
        topK: Math.min(Number(version.retrievalPolicy?.topK || 3), 3),
        maxChunks: Math.min(Number(version.retrievalPolicy?.maxChunks || 5), 3),
        maxContextChars: Math.min(Number(version.retrievalPolicy?.maxContextChars || 2400), 1800),
      }, process.env, searchKnowledgeChunks)
    : [];
  const agentImageCreditReservation = requestMode === 'image_generation' && !shouldUseToolCallingConversation(version)
    ? await reserveDbAgentImageCredits(pool, user, { sessionId, clientRequestId, model: version?.modelPolicy?.multimodalModel })
    : null;
  let agentImageCreditSettled = false;
  const contextTraceBase = {
    sessionId,
    clientRequestId,
    runId,
    requestMode,
    historyMessageCount: history.length,
    recentHistoryMessageIds: history.slice(-8).map((message) => message.id).filter(Boolean),
    summaryUsed: Boolean(summary),
    knowledgeChunkCount: requestMode === 'image_generation' ? imageKnowledgeChunks.length : 0,
    attachmentRefs: attachments.map((item) => ({
      name: item.name,
      kind: item.kind,
      url: item.url || '',
      assetId: item.assetId || '',
      mimeType: item.mimeType || '',
    })),
    imageMode: requestMode === 'image_generation',
  };
  const pendingUserMetadata = {
    selectedModel,
    reasoningLevel: payload?.reasoningLevel || null,
    webSearchEnabled: Boolean(payload?.webSearchEnabled),
    requestMode,
    clientRequestId,
    runId,
    status: 'pending',
    phase: 'submitted',
    pending: true,
    contextTrace: contextTraceBase,
    messageIds: { userMessageId, assistantMessageId },
  };
  const pendingAssistantMetadata = {
    selectedModel,
    fallbackFrom: null,
    usedRetrieval: false,
    reasoningLevel: payload?.reasoningLevel || null,
    webSearchEnabled: Boolean(payload?.webSearchEnabled),
    requestMode,
    clientRequestId,
    runId,
    status: 'pending',
    phase: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
    pending: true,
    progress: true,
    progressStage: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
    contextTrace: contextTraceBase,
    messageIds: { userMessageId, assistantMessageId },
    imagePlan: null,
    imageResultUrls: null,
    retrievalSummary: [],
  };
  const pendingLockPool = await getManagedAssetLockPool();
  const pendingLockConnection = await pendingLockPool.getConnection();
  let pendingConnection = null;
  let pendingAgentLockName = '';
  let pendingLockName = '';
  let pendingTransactionStarted = false;
  try {
    pendingAgentLockName = await acquireManagedAssetAgentLock(pendingLockConnection, session.agentId);
    pendingLockName = await acquireManagedAssetUserLock(pendingLockConnection, user.id);
    pendingConnection = await pool.getConnection();
    await pendingConnection.beginTransaction();
    pendingTransactionStarted = true;
    const [activeSessionRows] = await pendingConnection.query(
      `SELECT session.id
       FROM chat_sessions session
       INNER JOIN agents agent ON agent.id = session.agent_id
       INNER JOIN users owner ON owner.id = session.user_id AND owner.status = 'active'
       WHERE session.id = ? AND session.user_id = ? AND session.agent_id = ?
       LIMIT 1`,
      [sessionId, user.id, session.agentId],
    );
    if (!activeSessionRows?.[0]) {
      const error = new Error('智能体或会话已被删除，未写入新消息');
      error.code = 'managed_asset_agent_unavailable';
      error.statusCode = 409;
      throw error;
    }
    await assertOwnedActiveManagedAssetReferences({
      value: attachments,
      userId: user.id,
      pool: pendingConnection,
    });
    await pendingConnection.query(
      `INSERT INTO chat_messages (id, session_id, user_id, role, content, attachments_json, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userMessageId, sessionId, user.id, 'user', content, JSON.stringify(attachments), JSON.stringify(pendingUserMetadata), now]
    );
    await pendingConnection.query(
      `INSERT INTO chat_messages (id, session_id, user_id, role, content, attachments_json, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [assistantMessageId, sessionId, user.id, 'assistant', buildPendingAgentChatContent(requestMode), JSON.stringify(null), JSON.stringify(pendingAssistantMetadata), now + 1]
    );
    await pendingConnection.query(
      'UPDATE chat_sessions SET title = ?, selected_model = ?, reasoning_level = ?, web_search_enabled = ?, last_image_mode = ?, updated_at = ? WHERE id = ?',
      [session.title === '新会话' ? content.slice(0, 24) : session.title, selectedModel || '', payload?.reasoningLevel ? String(payload.reasoningLevel) : null, requestMode === 'image_generation' ? 0 : payload?.webSearchEnabled ? 1 : 0, requestMode === 'image_generation' ? 1 : 0, now, sessionId]
    );
    await pendingConnection.commit();
    pendingTransactionStarted = false;
  } catch (error) {
    if (pendingTransactionStarted && pendingConnection) await pendingConnection.rollback().catch(() => null);
    if (agentImageCreditReservation) {
      await releaseDbAgentImageCredits(pool, agentImageCreditReservation, { error, sessionId, clientRequestId });
    }
    throw error;
  } finally {
    if (pendingLockName) {
      await releaseManagedAssetUserLock(pendingLockConnection, pendingLockName).catch(() => null);
    }
    if (pendingAgentLockName) {
      await releaseManagedAssetUserLock(pendingLockConnection, pendingAgentLockName).catch(() => null);
    }
    pendingConnection?.release();
    pendingLockConnection.release();
  }
  const withDbChatReferenceFence = async (operation) => {
    const lockPool = await getManagedAssetLockPool();
    const lockConnection = await lockPool.getConnection();
    let connection = null;
    let agentLockName = '';
    let userLockName = '';
    let transactionStarted = false;
    try {
      agentLockName = await acquireManagedAssetAgentLock(lockConnection, session.agentId);
      userLockName = await acquireManagedAssetUserLock(lockConnection, user.id);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const [activeSessionRows] = await connection.query(
        `SELECT session.id
         FROM chat_sessions session
         INNER JOIN agents agent ON agent.id = session.agent_id
         INNER JOIN users owner ON owner.id = session.user_id AND owner.status = 'active'
         WHERE session.id = ? AND session.user_id = ? AND session.agent_id = ?
         LIMIT 1`,
        [sessionId, user.id, session.agentId],
      );
      if (!activeSessionRows?.[0]) {
        const error = new Error('智能体或会话已被删除，未写入对话结果');
        error.code = 'managed_asset_chat_session_unavailable';
        error.statusCode = 409;
        throw error;
      }
      const result = await operation(connection);
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted && connection) await connection.rollback().catch(() => null);
      throw error;
    } finally {
      if (userLockName) await releaseManagedAssetUserLock(lockConnection, userLockName).catch(() => null);
      if (agentLockName) await releaseManagedAssetUserLock(lockConnection, agentLockName).catch(() => null);
      connection?.release();
      lockConnection.release();
    }
  };
  let latestDbChatProviderTaskCheckpoint = null;
  const persistDbChatProviderTaskCheckpoint = async (checkpointResult = {}) => {
    const checkpoint = buildSubmittedImageTaskCheckpoint({
      checkpointResult,
      pendingUserMetadata,
      pendingAssistantMetadata,
      contextTraceBase,
      requestMode,
      imageKnowledgeChunkCount: imageKnowledgeChunks.length,
    });
    if (!checkpoint) return;
    const { providerTaskId, userMetadata: checkpointUserMetadata, assistantMetadata: checkpointAssistantMetadata } = checkpoint;
    latestDbChatProviderTaskCheckpoint = checkpoint.latestCheckpoint;
    try {
      await withDbChatReferenceFence(async (connection) => {
        const [userUpdate] = await connection.query(
          'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [JSON.stringify(checkpointUserMetadata), userMessageId, sessionId, user.id]
        );
        const [assistantUpdate] = await connection.query(
          'UPDATE chat_messages SET content = ?, attachments_json = ?, metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [
            checkpoint.assistantContent,
            JSON.stringify(null),
            JSON.stringify(checkpointAssistantMetadata),
            assistantMessageId,
            sessionId,
            user.id,
          ]
        );
        if (Number(userUpdate?.affectedRows || 0) !== 1 || Number(assistantUpdate?.affectedRows || 0) !== 1) {
          throw Object.assign(new Error('会话消息已被删除，未写入任务检查点'), {
            code: 'managed_asset_chat_session_unavailable',
            statusCode: 409,
          });
        }
        await connection.query('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId]);
      });
    } catch (error) {
      console.warn('[agent-chat] failed to persist provider task checkpoint', {
        sessionId,
        clientRequestId,
        providerTaskId,
        message: error?.message || String(error || ''),
      });
    }
  };
  const persistDbChatImageCheckpoint = async (checkpointResult = {}) => {
    const checkpoint = buildReadyImageCheckpoint({
      checkpointResult,
      pendingUserMetadata,
      pendingAssistantMetadata,
      contextTraceBase,
      requestMode,
      imageKnowledgeChunkCount: imageKnowledgeChunks.length,
    });
    if (!checkpoint) return;
    const { imageResultUrls, userMetadata: checkpointUserMetadata, assistantMetadata: checkpointAssistantMetadata } = checkpoint;
    try {
      await withDbChatReferenceFence(async (connection) => {
        const [userUpdate] = await connection.query(
          'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [JSON.stringify(checkpointUserMetadata), userMessageId, sessionId, user.id]
        );
        const [assistantUpdate] = await connection.query(
          'UPDATE chat_messages SET content = ?, attachments_json = ?, metadata_json = ?, created_at = ? WHERE id = ? AND session_id = ? AND user_id = ?',
          [
            checkpoint.assistantContent,
            JSON.stringify(buildAgentImageResultAttachments(imageResultUrls)),
            JSON.stringify(checkpointAssistantMetadata),
            Date.now(),
            assistantMessageId,
            sessionId,
            user.id,
          ]
        );
        if (Number(userUpdate?.affectedRows || 0) !== 1 || Number(assistantUpdate?.affectedRows || 0) !== 1) {
          throw Object.assign(new Error('会话消息已被删除，未写入图片检查点'), {
            code: 'managed_asset_chat_session_unavailable',
            statusCode: 409,
          });
        }
        await connection.query('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId]);
      });
    } catch (error) {
      console.warn('[agent-chat] failed to persist image checkpoint', {
        sessionId,
        clientRequestId,
        message: error?.message || String(error || ''),
      });
    }
  };
  const markDbChatRunFailed = async (error) => {
    const errorMessage = error?.message || '聊天回复失败。';
    const failedUserMetadata = {
      ...pendingUserMetadata,
      status: 'failed',
      phase: 'failed',
      pending: false,
      errorMessage,
      errorCode: error?.code || '',
    };
    const failedAssistantMetadata = {
      ...pendingAssistantMetadata,
      status: 'failed',
      phase: 'failed',
      pending: false,
      progress: false,
      progressStage: 'failed',
      errorMessage,
      errorCode: error?.code || '',
      providerStage: error?.providerStage || '',
      providerStatus: error?.providerStatus || '',
      providerTaskId: error?.providerTaskId || latestDbChatProviderTaskCheckpoint?.providerTaskId || '',
    };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
        [JSON.stringify(failedUserMetadata), userMessageId, sessionId, user.id]
      );
      await connection.query(
        'UPDATE chat_messages SET content = ?, attachments_json = ?, metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
        [errorMessage, JSON.stringify(null), JSON.stringify(failedAssistantMetadata), assistantMessageId, sessionId, user.id]
      );
      await connection.query('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId]);
      await connection.commit();
    } catch (updateError) {
      await connection.rollback();
      console.warn('[agent-chat] failed to persist failed pending message', {
        sessionId,
        clientRequestId,
        message: updateError?.message || String(updateError || ''),
      });
    } finally {
      connection.release();
    }
  };
  let result;
  try {
    if (shouldUseToolCallingConversation(version)) {
      const ctxLimits = resolveContextLimits({
        modelId: selectedModel,
        contextPolicy: version.contextPolicy || {},
      });
      const recentMessages = history
        .slice(-(ctxLimits.maxHistoryRounds * 2))
        .map((message) => ({ role: message.role, content: message.content }));
      const fallbackModels = resolveChatFallbackModels(version, selectedModel);
      const imageCapability = getImageModelCapability(version?.modelPolicy?.multimodalModel);
      const openaiCompatibleEnv = buildOpenAICompatibleRuntimeEnv(process.env, systemSettings);
      const callModel = async ({ messages, tools, toolChoice, maxTokens, onDelta }) => {
        void toolChoice;
        const output = await executeProviderJobWithManagedAssetScrub({
          userId: user.id,
          taskType: 'openai_responses',
          payload: {
            model: selectedModel,
            fallbackModels,
            messages,
            tools,
            reasoningLevel: payload?.reasoningLevel || null,
            maxTokens,
          },
        }, openaiCompatibleEnv, new AbortController().signal, {
          onDelta: (delta) => {
            onDelta?.(delta);
            if (sendEvent) sendEvent('streaming', { delta });
          },
        });
        return {
          content: output?.content ?? output?.result?.content ?? '',
          toolCalls: output?.toolCalls || output?.result?.toolCalls || [],
          finishReason: output?.finishReason || output?.result?.finishReason || '',
          modelUsed: output?.modelUsed || output?.result?.modelUsed || selectedModel,
        };
      };
      const generateImage = async ({ prompt, taskType, inputImageUrls, aspectRatio, model }) => {
        const imageCreditReservation = await reserveDbAgentImageCredits(pool, user, { sessionId, clientRequestId, taskType, model });
        let imageOutput;
        try {
          imageOutput = await executeProviderJobWithManagedAssetScrub({
            userId: user.id,
            taskType: 'kie_image',
            payload: {
              imageUrls: inputImageUrls,
              prompt,
              model,
              aspectRatio: aspectRatio || 'auto',
              resolution: String(imageCapability?.defaultResolution || '1K'),
            },
          }, process.env, new AbortController().signal, {
            onProviderTaskId: async (providerTaskId) => {
              await persistDbChatProviderTaskCheckpoint({
                content: '图片任务已提交，正在生成中。',
                providerTaskId,
                selectedModel: model || selectedModel,
                taskType,
                inputImageUrls,
                prompt,
                size: aspectRatio || 'auto',
                imagePlan: {
                  requestMode: 'tool_calling',
                  taskType,
                  selectedImageModel: model || '',
                  inputImageUrls,
                  prompt,
                  size: aspectRatio || 'auto',
                  providerTaskId,
                },
              });
              if (sendEvent) sendEvent('progress', { stage: 'image_generating', providerTaskId });
            },
          });
          await settleDbAgentImageCredits(pool, imageCreditReservation, { result: imageOutput, sessionId, clientRequestId });
        } catch (error) {
          await releaseDbAgentImageCredits(pool, imageCreditReservation, { error, sessionId, clientRequestId });
          throw error;
        }
        const rawUrl = String(imageOutput?.result?.imageUrl || '').trim();
        const persistedUrl = await persistRuntimeRemoteAssetIfEnabled({
          userId: user.id,
          moduleName: 'agent_center',
          assetType: 'result',
          remoteUrl: rawUrl,
          originalName: `${model || 'image_result'}.png`,
          provider: isMaxForAiImageModel(model) ? 'maxforai' : 'kie',
          jobId: normalizeStoredAssetJobId(imageOutput?.providerTaskId || runId || clientRequestId),
        });
        const imageUrl = persistedUrl || rawUrl;
        const providerTaskId = String(imageOutput?.providerTaskId || '');
        return { imageUrl, providerTaskId, creditsConsumed: getProviderCreditsConsumed(imageOutput) };
      };
      result = await runAgentConversationV2({
        systemPrompt: version.systemPrompt || '',
        summary,
        recentMessages,
        currentMessage: content,
        attachments,
        priorMessages: history,
        imageGenerationEnabled: Boolean(version?.modelPolicy?.imageGenerationEnabled),
        imageMode: requestMode === 'image_generation',
        selectedImageModel: String(version?.modelPolicy?.multimodalModel || '').trim(),
        maxInputImages: Number(imageCapability?.maxInputImages || 1),
        contextLimits: ctxLimits,
        hasKnowledgeBase: cleanKnowledgeBaseIds(version?.knowledgeBaseIds).length > 0 && Boolean(version?.retrievalPolicy?.enabled),
        webSearchEnabled: Boolean(payload?.webSearchEnabled),
        searchKnowledge: async (query) => searchKnowledgeChunksByVector(
          query,
          await listDbKnowledgeChunksForVersion(version),
          version.retrievalPolicy || {},
          process.env,
          searchKnowledgeChunks
        ),
        callModel,
        generateImage,
        onImageResultReady: persistDbChatImageCheckpoint,
        prepareModelImageUrl: prepareAgentModelImageUrl(user.id),
        onProgress: (event) => {
          setChatProgress(clientRequestId, event);
          if (sendEvent) sendEvent('progress', event);
        },
      });
      result.usedRetrieval = false;
      result.retrievalSummary = [];
      result.promptTokens = result.promptTokens || 0;
      result.completionTokens = result.completionTokens || 0;
      result.fallbackFrom = null;
    } else {
      result = requestMode === 'image_generation'
        ? await buildImageConversationResult({
            user,
            agent,
            version,
            priorMessages: history,
            currentMessage: content,
            sessionId,
            selectedModelOverride: selectedModel,
            attachments,
            systemSettings,
            knowledgeChunks: imageKnowledgeChunks,
            conversationSummary: summary,
            onImageReady: persistDbChatImageCheckpoint,
            runId,
            clientRequestId,
          })
        : await runAgentConversation({
            user,
            agent,
            version,
            priorMessages: history,
            currentMessage: content,
            sessionId,
            selectedModelOverride: selectedModel,
            attachments,
            reasoningLevel: payload?.reasoningLevel || null,
            webSearchEnabled: Boolean(payload?.webSearchEnabled),
            onProgress: (progress) => {
              setChatProgress(clientRequestId, progress);
              if (sendEvent) sendEvent('progress', progress);
            },
          });
    }
    if (agentImageCreditReservation) {
      await settleDbAgentImageCredits(pool, agentImageCreditReservation, { result, sessionId, clientRequestId });
      agentImageCreditSettled = true;
    }
  } catch (error) {
    if (agentImageCreditReservation && !agentImageCreditSettled) {
      await releaseDbAgentImageCredits(pool, agentImageCreditReservation, { error, sessionId, clientRequestId });
    }
    await markDbChatRunFailed(error);
    throw error;
  }
  const assistantAttachments = buildAgentImageResultAttachments(result.imageResultUrls);
  const assistantCreatedAt = Date.now();
  const contextTrace = {
    ...contextTraceBase,
    knowledgeChunkCount: requestMode === 'image_generation'
      ? imageKnowledgeChunks.length
      : Array.isArray(result.retrievalSummary)
        ? result.retrievalSummary.length
        : 0,
  };
  const userMetadata = {
    ...pendingUserMetadata,
    status: 'completed',
    pending: false,
    phase: 'submitted',
    contextTrace,
  };
  const assistantMetadata = {
    selectedModel: result.selectedModel,
    fallbackFrom: result.fallbackFrom || null,
    usedRetrieval: result.usedRetrieval,
    reasoningLevel: payload?.reasoningLevel || null,
    webSearchEnabled: Boolean(payload?.webSearchEnabled),
    requestMode,
    clientRequestId,
    runId,
    status: 'completed',
    pending: false,
    progress: false,
    phase: 'completed',
    contextTrace,
    messageIds: { userMessageId, assistantMessageId },
    imagePlan: result.imagePlan || latestDbChatProviderTaskCheckpoint?.imagePlan || null,
    imageResultUrls: result.imageResultUrls || null,
    retrievalSummary: result.retrievalSummary || [],
    providerTaskId: result.providerTaskId || result.imagePlan?.providerTaskId || latestDbChatProviderTaskCheckpoint?.providerTaskId || '',
    finalReplyErrorMessage: result.finalReplyErrorMessage || '',
  };
  const finalLockPool = await getManagedAssetLockPool();
  const finalLockConnection = await finalLockPool.getConnection();
  let connection = null;
  let finalAgentLockName = '';
  let finalUserLockName = '';
  try {
    finalAgentLockName = await acquireManagedAssetAgentLock(finalLockConnection, session.agentId);
    finalUserLockName = await acquireManagedAssetUserLock(finalLockConnection, user.id);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [activeSessionRows] = await connection.query(
      `SELECT session.id
       FROM chat_sessions session
       INNER JOIN agents agent ON agent.id = session.agent_id
       INNER JOIN users owner ON owner.id = session.user_id AND owner.status = 'active'
       WHERE session.id = ? AND session.user_id = ? AND session.agent_id = ?
       LIMIT 1`,
      [sessionId, user.id, session.agentId],
    );
    if (!activeSessionRows?.[0]) {
      const error = new Error('智能体或会话已被删除，未写入生成结果');
      error.code = 'managed_asset_chat_session_unavailable';
      error.statusCode = 409;
      throw error;
    }
    const [userMessageUpdate] = await connection.query(
      'UPDATE chat_messages SET metadata_json = ? WHERE id = ? AND session_id = ? AND user_id = ?',
      [JSON.stringify(userMetadata), userMessageId, sessionId, user.id]
    );
    const [assistantMessageUpdate] = await connection.query(
      'UPDATE chat_messages SET content = ?, attachments_json = ?, metadata_json = ?, created_at = ? WHERE id = ? AND session_id = ? AND user_id = ?',
      [result.content, JSON.stringify(assistantAttachments), JSON.stringify(assistantMetadata), assistantCreatedAt, assistantMessageId, sessionId, user.id]
    );
    if (Number(userMessageUpdate?.affectedRows || 0) !== 1 || Number(assistantMessageUpdate?.affectedRows || 0) !== 1) {
      const error = new Error('会话消息已被删除，未写入生成结果');
      error.code = 'managed_asset_chat_session_unavailable';
      error.statusCode = 409;
      throw error;
    }
    await connection.query(
      'UPDATE chat_sessions SET title = ?, summary = ?, selected_model = ?, reasoning_level = ?, web_search_enabled = ?, last_image_mode = ?, updated_at = ? WHERE id = ?',
      [session.title === '新会话' ? content.slice(0, 24) : session.title, summary, selectedModel || '', payload?.reasoningLevel ? String(payload.reasoningLevel) : null, requestMode === 'image_generation' ? 0 : payload?.webSearchEnabled ? 1 : 0, requestMode === 'image_generation' ? 1 : 0, Date.now(), sessionId]
    );
    await connection.commit();
  } catch (error) {
    if (connection) await connection.rollback().catch(() => null);
    throw error;
  } finally {
    if (finalUserLockName) {
      await releaseManagedAssetUserLock(finalLockConnection, finalUserLockName).catch(() => null);
    }
    if (finalAgentLockName) {
      await releaseManagedAssetUserLock(finalLockConnection, finalAgentLockName).catch(() => null);
    }
    connection?.release();
    finalLockConnection.release();
  }
  result.clientRequestId = clientRequestId;
  result.runId = runId;
  void createDbAgentUsageLog(user, agent, version, result, 'success').catch((error) => {
    console.warn('[agent-chat] usage log write failed', {
      sessionId,
      clientRequestId,
      message: error?.message || String(error || ''),
    });
  });
  return {
    userMessage: {
      id: userMessageId,
      sessionId,
      userId: user.id,
      role: 'user',
      content,
      attachments,
      metadata: userMetadata,
      createdAt: now,
    },
    assistantMessage: {
      id: assistantMessageId,
      sessionId,
      userId: user.id,
      role: 'assistant',
      content: result.content,
      attachments: assistantAttachments,
      metadata: assistantMetadata,
      createdAt: assistantCreatedAt,
    },
    usage: result,
  };
  })();

  activeDbChatReplyRequests.set(activeKey, promise);
  try {
    return await promise;
  } finally {
    activeDbChatReplyRequests.delete(activeKey);
  }
};

const listDbAgentUsage = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE a.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT l.*
     FROM agent_usage_logs l
     LEFT JOIN agents a ON a.id = l.agent_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT 200`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    selectedModel: row.selected_model,
    usedRetrieval: Boolean(row.used_retrieval),
    totalTokens: Number(row.total_tokens || 0),
    estimatedCost: Number(row.estimated_cost || 0),
    latencyMs: Number(row.latency_ms || 0),
    status: row.status,
    createdAt: Number(row.created_at),
  }));
};

const getDbAgentUsageSummary = async (user) => {
  const rows = await listDbAgentUsage(user);
  return {
    totalCalls: rows.length,
    successCount: rows.filter((row) => row.status === 'success').length,
    failedCount: rows.filter((row) => row.status !== 'success').length,
    activeUsers: new Set(rows.map((row) => row.userId)).size,
    totalEstimatedCost: Number(rows.reduce((sum, row) => sum + row.estimatedCost, 0).toFixed(6)),
  };
};

const aggregateAgentUsageStatsRows = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    const statDate = new Date(Number(row.createdAt || row.created_at || Date.now())).toISOString().split('T')[0];
    const userId = row.userId || row.user_id;
    const username = row.username;
    const displayName = row.displayName || row.display_name || row.username;
    const key = `${statDate}|${userId}|agent_center`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        statDate,
        userId,
        username,
        displayName,
        module: 'agent_center',
        successCount: 0,
        failedCount: 0,
        interruptedCount: 0,
      });
    }
    const target = byKey.get(key);
    if (row.status === 'success') target.successCount += 1;
    else if (row.status === 'failed') target.failedCount += 1;
    else if (row.status === 'interrupted') target.interruptedCount += 1;
  }
  return Array.from(byKey.values());
};

const getDbJobByIdForUser = async (user, jobId) => {
  const pool = await getMysqlPool();
  const job = await getJobById(pool, jobId);
  if (!job) return null;
  if (user.role !== 'admin' && job.userId !== user.id) return null;
  return job;
};

const recordDbTaskPlatformEvent = async (pool, job, event) => {
  try {
    await recordJobEvent(pool, job, {
      engine: normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE),
      ...event,
    });
  } catch (error) {
    console.error('Task platform event write failed.', error);
  }
};

const mirrorDbJobToTemporalIfEnabled = async (pool, job) => {
  const engine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
  if (engine === 'mysql') return null;
  const executionMode = engine === 'temporal' ? 'execute' : 'observe';
  const result = await temporalTaskAdapter.startJobWorkflow(job, { executionMode, ledger: 'mysql' });
  const workflowAvailable = result.started || result.code === 'temporal_workflow_already_started';
  await recordDbTaskPlatformEvent(pool, job, {
    stage: engine === 'temporal' ? 'workflow' : 'temporal_mirror',
    eventName: result.started
      ? 'temporal_workflow_started'
      : result.code === 'temporal_workflow_already_started'
        ? 'temporal_workflow_already_started'
        : 'temporal_workflow_unavailable',
    status: workflowAvailable ? 'started' : 'failed',
    providerSubmitted: false,
    retryable: !workflowAvailable,
    workflowId: result.workflowId || '',
    runId: result.runId || '',
    errorCode: workflowAvailable ? '' : result.code || 'temporal_start_failed',
    errorMessage: workflowAvailable ? '' : result.message || 'Temporal workflow start failed.',
    meta: {
      engine,
      executionMode,
      temporal: result,
    },
  });
  if (engine === 'temporal' && !workflowAvailable) {
    const failedAt = Date.now();
    await pool.query(
      `UPDATE internal_jobs
       SET status = 'failed', error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'retry_waiting')`,
      [
        result.code || 'temporal_start_failed',
        result.message || 'Temporal workflow start failed.',
        failedAt,
        failedAt,
        job.id,
      ]
    );
  }
  return result;
};

const resumePendingDbTemporalJobs = async (pool, limit = 100) => {
  const engine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
  if (engine !== 'temporal' || !temporalTaskAdapter.configured) return 0;
  const [rows] = await pool.query(
    `SELECT id
     FROM internal_jobs
     WHERE status IN ('queued', 'retry_waiting')
     ORDER BY created_at ASC
     LIMIT ?`,
    [Math.max(1, Math.min(500, Number(limit || 100)))]
  );
  let resumed = 0;
  for (const row of rows) {
    const job = await getJobById(pool, row.id);
    if (!job) continue;
    const result = await mirrorDbJobToTemporalIfEnabled(pool, job);
    if (result?.started || result?.code === 'temporal_workflow_already_started') resumed += 1;
  }
  return resumed;
};

const getTemporalProviderlessRunningStaleMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_PROVIDERLESS_RUNNING_STALE_MS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
};

const getTemporalSubmittedRunningStaleMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_SUBMITTED_RUNNING_STALE_MS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6 * 60 * 60 * 1000;
};

const getTemporalCancelledRunningStaleMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_CANCELLED_RUNNING_STALE_MS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 1000;
};

const getTemporalStaleReconcilerIntervalMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 1000;
};

const getTemporalStaleReconcilerMaxBackoffMs = () => {
  const parsed = Number.parseInt(String(process.env.MEIAO_STALE_RUNNING_RECONCILE_MAX_BACKOFF_MS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
};

const runTemporalStaleRunningJobReconcile = async (pool, reason = 'interval') => {
  const engine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
  if (engine !== 'temporal' || !temporalTaskAdapter.configured) return 0;
  const cancelledJobs = await reconcileStaleCancelledRunningJobs(pool, {
    staleMs: getTemporalCancelledRunningStaleMs(),
  });
  const recoveredJobs = await reconcileStaleProviderlessRunningJobs(pool, {
    staleMs: getTemporalProviderlessRunningStaleMs(),
  });
  const submittedJobs = await reconcileStaleSubmittedRunningJobs(pool, {
    staleMs: getTemporalSubmittedRunningStaleMs(),
  });
  const totalRecovered = cancelledJobs.length + recoveredJobs.length + submittedJobs.length;
  if (totalRecovered > 0) {
    if (cancelledJobs.length > 0) {
      console.log(`Recovered ${cancelledJobs.length} cancelled running Temporal jobs (${reason}).`);
    }
    if (recoveredJobs.length > 0) {
      console.log(`Recovered ${recoveredJobs.length} providerless running Temporal jobs (${reason}).`);
    }
    if (submittedJobs.length > 0) {
      console.log(`Recovered ${submittedJobs.length} submitted running Temporal jobs (${reason}).`);
    }
    const resumed = await resumePendingDbTemporalJobs(pool, Math.max(100, totalRecovered + 20));
    if (resumed > 0) {
      console.log(`Resumed ${resumed} Temporal jobs after stale running recovery.`);
    }
  }
  return totalRecovered;
};

const startTemporalStaleRunningJobReconciler = (pool) => {
  if (staleRunningJobReconcilerTimer) return;
  let busy = false;
  let consecutiveFailures = 0;
  const baseMs = getTemporalStaleReconcilerIntervalMs();
  const maxMs = getTemporalStaleReconcilerMaxBackoffMs();
  const scheduleNext = () => {
    const delay = getReconcileBackoffMs(consecutiveFailures, baseMs, maxMs);
    staleRunningJobReconcilerTimer = setTimeout(() => { void run('interval'); }, delay);
    staleRunningJobReconcilerTimer.unref?.();
  };
  const run = async (reason) => {
    if (busy) return;
    busy = true;
    try {
      await runTemporalStaleRunningJobReconcile(pool, reason);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`Temporal stale running job reconcile failed (consecutive ${consecutiveFailures}).`, error);
    } finally {
      busy = false;
      scheduleNext();
    }
  };
  scheduleNext();
};

const shouldUseTemporalForLocalExecution = () => normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE) === 'temporal';

const startLocalJobWorkflowIfEnabled = async (store, job) => {
  const engine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
  if (engine === 'mysql') return null;
  const executionMode = engine === 'temporal' ? 'execute' : 'observe';

  const result = await temporalTaskAdapter.startJobWorkflow(job, {
    executionMode,
  });
  if (result.started) {
    attachLocalJobWorkflowExecution(store, job.id, result, { engine, executionMode });
  }

  if (engine === 'temporal' && !result.started) {
    const failedJob = markLocalJobFailed(store, job.id, {
      code: result.code || 'temporal_start_failed',
      message: result.message || 'Temporal workflow start failed.',
    });
    if (failedJob) {
      appendLocalLog(store, {
        user: findLocalUserById(failedJob.userId),
        level: 'error',
        module: failedJob.module,
        action: 'job_failed',
        message: `${failedJob.taskType} 任务启动失败`,
        detail: failedJob.errorMessage,
        status: 'failed',
        meta: buildJobRuntimeLogMeta({
          job: failedJob,
          error: { code: failedJob.errorCode, message: failedJob.errorMessage },
          finishedAt: failedJob.finishedAt || Date.now(),
          retryCount: failedJob.retryCount,
        }),
      });
    }
  }
  return result;
};

const incrementLocalUsageStat = (store, log) => {
  if (!shouldTrackUsageStatLog(log)) {
    return;
  }

  if (!Array.isArray(store.usageDaily)) {
    store.usageDaily = [];
  }

  const statDate = new Date(log.createdAt).toISOString().split('T')[0];
  let row = store.usageDaily.find((r) => r.statDate === statDate && r.userId === log.userId && r.module === log.module);
  if (!row) {
    row = { statDate, userId: log.userId, username: log.username, displayName: log.displayName, module: log.module, successCount: 0, failedCount: 0, interruptedCount: 0, creditsConsumed: 0 };
    store.usageDaily.push(row);
  }

  if (log.status === 'success') row.successCount++;
  else if (log.status === 'failed') row.failedCount++;
  else if (log.status === 'interrupted') row.interruptedCount++;
  row.creditsConsumed = Number(row.creditsConsumed || 0) + extractUsageCreditsConsumed(log);
};

const appendLocalLog = (store, payload) => {
  const log = createLogEntry(payload);
  store.logs = normalizeLogs([log, ...(store.logs || [])]);
  incrementLocalUsageStat(store, log);
  return log;
};

const deleteLocalLogs = (store, filters = {}) => {
  const originalCount = Array.isArray(store.logs) ? store.logs.length : 0;
  store.logs = normalizeLogs((store.logs || []).filter((log) => !matchesLogFilters(log, filters)));
  return Math.max(0, originalCount - store.logs.length);
};

const listLocalLogs = (store, filters = {}) => {
  const filtered = normalizeLogs(store.logs).filter((log) => matchesLogFilters(log, filters));
  const { page, pageSize, offset } = normalizeLogPagination(filters);
  return {
    logs: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
};

const listLocalLogMeta = (store) => {
  return buildLogFilterOptions(normalizeLogs(store.logs));
};

const listLocalManageableKnowledgeBaseIds = (store, user, ids) =>
  cleanKnowledgeBaseIds(ids).filter((knowledgeBaseId) => {
    const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === knowledgeBaseId);
    return Boolean(knowledgeBase && knowledgeBase.status === 'active' && canManageOwnedResource(user, knowledgeBase.ownerUserId));
  });

const listLocalVersionKnowledgeBaseIds = (store, versionId) =>
  (store.agentVersionKnowledgeBases || [])
    .filter((item) => item.agentVersionId === versionId)
    .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
    .map((item) => item.knowledgeBaseId);

const syncLocalVersionKnowledgeBases = (store, versionId, knowledgeBaseIds) => {
  store.agentVersionKnowledgeBases = Array.isArray(store.agentVersionKnowledgeBases) ? store.agentVersionKnowledgeBases : [];
  store.agentVersionKnowledgeBases = store.agentVersionKnowledgeBases.filter((item) => item.agentVersionId !== versionId);
  cleanKnowledgeBaseIds(knowledgeBaseIds).forEach((knowledgeBaseId, index) => {
    store.agentVersionKnowledgeBases.push({
      id: createEntityId(),
      agentVersionId: versionId,
      knowledgeBaseId,
      priority: index,
      createdAt: Date.now(),
    });
  });
};

const getLocalAgentById = (store, agentId) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent) return null;
  const version = getLocalAgentVersionById(store, agent.currentVersionId);
  const knowledgeBaseIds = agent.currentVersionId ? listLocalVersionKnowledgeBaseIds(store, agent.currentVersionId) : [];
  const usageCount7d = (store.agentUsageLogs || []).filter((row) => row.agentId === agentId && row.createdAt >= Date.now() - AGENT_SUMMARY_WINDOW_MS).length;
  const owner = (store.users || []).find((item) => item.id === agent.ownerUserId);
  return {
    ...agent,
    ownerDisplayName: owner?.displayName || owner?.username || '',
    currentVersionNo: version?.versionNo || null,
    defaultModel: version?.modelPolicy?.defaultModel || '',
    allowedChatModels: version?.allowedChatModels || [],
    defaultChatModel: version?.defaultChatModel || version?.modelPolicy?.defaultModel || '',
    imageGenerationEnabled: Boolean(version?.modelPolicy?.imageGenerationEnabled),
    imageModel: version?.modelPolicy?.multimodalModel || '',
    imageMaxInputCount: Number(getImageModelCapability(version?.modelPolicy?.multimodalModel)?.maxInputImages || 1),
    knowledgeBaseCount: knowledgeBaseIds.length,
    usageCount7d,
  };
};

const getLocalAgentVersionById = (store, versionId) => {
  const row = (store.agentVersions || []).find((item) => item.id === versionId);
  if (!row) return null;
  return normalizeAgentVersionRecord({
    id: row.id,
    agent_id: row.agentId,
    version_no: row.versionNo,
    version_name: row.versionName,
    allowed_chat_models_json: stringifyJsonField(row.allowedChatModels || []),
    default_chat_model: row.defaultChatModel || '',
    is_published: row.isPublished,
    system_prompt: row.systemPrompt,
    reply_style_rules_json: stringifyJsonField(row.replyStyleRules),
    model_policy_json: stringifyJsonField(row.modelPolicy),
    context_policy_json: stringifyJsonField(row.contextPolicy),
    retrieval_policy_json: stringifyJsonField(row.retrievalPolicy),
    tool_policy_json: stringifyJsonField(row.toolPolicy),
    knowledge_document_bindings_json: stringifyJsonField(row.knowledgeDocumentBindings || [], []),
    validation_status: row.validationStatus,
    validation_summary_json: row.validationSummary ? JSON.stringify(row.validationSummary) : null,
    created_by: row.createdBy,
    created_at: row.createdAt,
  }, listLocalVersionKnowledgeBaseIds(store, versionId));
};

const listLocalAgentVersionsByAgentId = (store, agentId) =>
  (store.agentVersions || [])
    .filter((item) => item.agentId === agentId)
    .sort((a, b) => Number(b.versionNo || 0) - Number(a.versionNo || 0))
    .map((item) => getLocalAgentVersionById(store, item.id))
    .filter(Boolean);

const listLocalAgents = (store, user) =>
  (store.agents || [])
    .filter((item) => isSuperAdminUser(user) || item.ownerUserId === user.id)
    .map((item) => getLocalAgentById(store, item.id))
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

const createLocalAgent = (store, user, payload) => {
  const now = Date.now();
  const agentId = createEntityId();
  const version = buildAgentVersionInsertRecord({
    agentId,
    versionNo: 1,
    createdBy: user.id,
    source: {
      systemPrompt: payload.systemPrompt || '',
      allowedChatModels: payload.allowedChatModels || [],
      defaultChatModel: payload.defaultChatModel || '',
      replyStyleRules: payload.replyStyleRules || {},
      modelPolicy: payload.modelPolicy || {},
      contextPolicy: payload.contextPolicy || {},
      retrievalPolicy: payload.retrievalPolicy || {},
      toolPolicy: payload.toolPolicy || {},
      knowledgeBaseIds: listLocalManageableKnowledgeBaseIds(store, user, payload.knowledgeBaseIds || []),
    },
  });
  store.agents.push({
    id: agentId,
    name: String(payload.name || '未命名智能体').slice(0, 120),
    description: String(payload.description || '').slice(0, 5000),
    department: String(payload.department || '未分组').slice(0, 120),
    iconUrl: payload.iconUrl ? String(payload.iconUrl).slice(0, 1024) : '',
    avatarPreset: payload.avatarPreset ? String(payload.avatarPreset).slice(0, 40) : '',
    ownerUserId: user.id,
    visibilityScope: AGENT_VISIBILITY_SCOPE,
    status: 'draft',
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.agentVersions.push({
    id: version.id,
    agentId,
    versionNo: version.versionNo,
    versionName: version.versionName,
    allowedChatModels: version.allowedChatModels,
    defaultChatModel: version.defaultChatModel || '',
    isPublished: false,
    systemPrompt: version.systemPrompt,
    openingRemarks: String(payload.openingRemarks || '').slice(0, 2000) || null,
    knowledgeDocumentBindings: normalizeVersionKnowledgeDocumentBindings(payload.knowledgeDocumentBindings || [], version.knowledgeBaseIds),
    replyStyleRules: parseJsonField(version.replyStyleRulesJson, {}),
    modelPolicy: parseJsonField(version.modelPolicyJson, {}),
    contextPolicy: parseJsonField(version.contextPolicyJson, {}),
    retrievalPolicy: parseJsonField(version.retrievalPolicyJson, {}),
    toolPolicy: parseJsonField(version.toolPolicyJson, {}),
    validationStatus: 'pending',
    validationSummary: null,
    createdBy: user.id,
    createdAt: now,
  });
  syncLocalVersionKnowledgeBases(store, version.id, version.knowledgeBaseIds);
  return {
    agent: getLocalAgentById(store, agentId),
    version: getLocalAgentVersionById(store, version.id),
  };
};

const updateLocalAgent = (store, user, agentId, payload) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  if (typeof payload.name === 'string') agent.name = payload.name.slice(0, 120);
  if (typeof payload.description === 'string') agent.description = payload.description.slice(0, 5000);
  if (typeof payload.department === 'string') agent.department = payload.department.slice(0, 120);
  if (payload.iconUrl === null) agent.iconUrl = '';
  else if (typeof payload.iconUrl === 'string') agent.iconUrl = payload.iconUrl.slice(0, 1024);
  if (payload.avatarPreset === null) agent.avatarPreset = '';
  else if (typeof payload.avatarPreset === 'string') agent.avatarPreset = payload.avatarPreset.slice(0, 40);
  if (payload.status) agent.status = normalizeAgentStatus(payload.status);
  agent.updatedAt = Date.now();
  return getLocalAgentById(store, agentId);
};

const deleteLocalAgentVersion = (store, user, versionId) => {
  const version = getLocalAgentVersionById(store, versionId);
  if (!version || version.isPublished) return null;
  const agent = getLocalAgentById(store, version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  store.agentVersions = (store.agentVersions || []).filter((item) => item.id !== versionId);
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((item) => item.agentVersionId !== versionId);
  const rawAgent = (store.agents || []).find((item) => item.id === agent.id);
  if (rawAgent) rawAgent.updatedAt = Date.now();
  return { ok: true, deletedVersionId: versionId };
};

const deleteLocalAgent = async (store, user, agentId) => {
  const agent = getLocalAgentById(store, agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const versionIds = new Set((store.agentVersions || []).filter((item) => item.agentId === agentId).map((item) => item.id));
  const sessionIds = new Set((store.chatSessions || []).filter((item) => item.agentId === agentId).map((item) => item.id));
  const deletedMessages = (store.chatMessages || []).filter((item) => sessionIds.has(item.sessionId));
  const assetIds = Array.from(new Set([
    ...collectStoredAssetIdsFromChatMessages(deletedMessages),
    ...collectStoredAssetIdsFromValue(agent.iconUrl),
  ]));
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((item) => !versionIds.has(item.agentVersionId));
  store.agentVersions = (store.agentVersions || []).filter((item) => item.agentId !== agentId);
  store.chatMessages = (store.chatMessages || []).filter((item) => !sessionIds.has(item.sessionId));
  store.chatSessions = (store.chatSessions || []).filter((item) => item.agentId !== agentId);
  store.agentUsageLogs = (store.agentUsageLogs || []).filter((item) => item.agentId !== agentId);
  store.agents = (store.agents || []).filter((item) => item.id !== agentId);
  const cleanup = await queueStoredAssetsAfterReferenceRemoval({
    pool: null,
    assetIds,
    reason: 'agent_deleted',
    referenceStore: store,
    allowAnyOwner: true,
  });
  return { ok: true, deletedAgentId: agentId, deletedAssetIds: cleanup.deletedAssetIds };
};

const deleteLocalUserAgentHistory = async (store, user, agentId) => {
  const agent = getLocalAgentById(store, agentId);
  if (!agent || agent.status !== 'published') return null;
  const deletedSessionIds = new Set(
    (store.chatSessions || [])
      .filter((item) => item.userId === user.id && item.agentId === agentId)
      .map((item) => item.id)
  );
  const deletedSessionCount = deletedSessionIds.size;
  const originalMessageCount = (store.chatMessages || []).length;
  const originalUsageCount = (store.agentUsageLogs || []).length;
  const historyMessages = (store.chatMessages || []).filter((item) => item.userId === user.id && deletedSessionIds.has(item.sessionId));
  const historyAssetIds = collectStoredAssetIdsFromChatMessages(historyMessages);
  store.chatMessages = (store.chatMessages || []).filter((item) => !(item.userId === user.id && deletedSessionIds.has(item.sessionId)));
  store.chatSessions = (store.chatSessions || []).filter((item) => !(item.userId === user.id && item.agentId === agentId));
  store.agentUsageLogs = (store.agentUsageLogs || []).filter((item) => !(item.userId === user.id && item.agentId === agentId));
  await deleteStoredAssetsByIdsForUser({
    user,
    assetIds: historyAssetIds,
    reason: 'agent_chat_history_deleted',
    referenceStore: store,
  });
  return {
    ok: true,
    deletedSessionCount,
    deletedMessageCount: originalMessageCount - store.chatMessages.length,
    deletedUsageCount: originalUsageCount - store.agentUsageLogs.length,
    deletedAssetIds: historyAssetIds,
  };
};

const createLocalAgentDraft = (store, user, agentId) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const versions = listLocalAgentVersionsByAgentId(store, agentId);
  const source = versions[0] || null;
  const next = buildAgentVersionInsertRecord({
    agentId,
    versionNo: Math.max(0, ...versions.map((item) => item.versionNo)) + 1,
    createdBy: user.id,
    source,
  });
  store.agentVersions.push({
    id: next.id,
    agentId,
    versionNo: next.versionNo,
    versionName: next.versionName,
    allowedChatModels: next.allowedChatModels,
    defaultChatModel: next.defaultChatModel || '',
    isPublished: false,
    systemPrompt: next.systemPrompt,
    knowledgeDocumentBindings: parseJsonField(next.knowledgeDocumentBindingsJson, []),
    replyStyleRules: parseJsonField(next.replyStyleRulesJson, {}),
    modelPolicy: parseJsonField(next.modelPolicyJson, {}),
    contextPolicy: parseJsonField(next.contextPolicyJson, {}),
    retrievalPolicy: parseJsonField(next.retrievalPolicyJson, {}),
    toolPolicy: parseJsonField(next.toolPolicyJson, {}),
    validationStatus: 'pending',
    validationSummary: null,
    createdBy: user.id,
    createdAt: next.createdAt,
  });
  syncLocalVersionKnowledgeBases(store, next.id, next.knowledgeBaseIds);
  agent.updatedAt = Date.now();
  return getLocalAgentVersionById(store, next.id);
};

const updateLocalAgentVersion = (store, user, versionId, payload) => {
  const row = (store.agentVersions || []).find((item) => item.id === versionId);
  if (!row || row.isPublished) return null;
  const agent = (store.agents || []).find((item) => item.id === row.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const current = getLocalAgentVersionById(store, versionId);
  const config = normalizeAgentConfig({
    systemPrompt: payload.systemPrompt ?? current.systemPrompt,
    knowledgeDocumentBindings: payload.knowledgeDocumentBindings ?? current.knowledgeDocumentBindings,
    replyStyleRules: payload.replyStyleRules ?? current.replyStyleRules,
    modelPolicy: payload.modelPolicy ?? current.modelPolicy,
    contextPolicy: payload.contextPolicy ?? current.contextPolicy,
    retrievalPolicy: payload.retrievalPolicy ?? current.retrievalPolicy,
    toolPolicy: payload.toolPolicy ?? current.toolPolicy,
  });
  const nextAllowedChatModels = sanitizeAllowedChatModels(
    Array.isArray(payload.allowedChatModels) ? payload.allowedChatModels : current.allowedChatModels,
    [payload.defaultChatModel, current.defaultChatModel, config.modelPolicy.defaultModel, config.modelPolicy.cheapModel]
  );
  const nextModelPolicy = sanitizeModelPolicy(config.modelPolicy, nextAllowedChatModels);
  row.systemPrompt = config.systemPrompt;
  if (Object.prototype.hasOwnProperty.call(payload, 'openingRemarks')) {
    row.openingRemarks = payload.openingRemarks ? String(payload.openingRemarks).slice(0, 2000) : null;
  }
  row.versionName = normalizeVersionName(payload.versionName, current.versionNo, current.createdAt);
  row.allowedChatModels = nextAllowedChatModels;
  row.defaultChatModel = nextAllowedChatModels.includes(String(payload.defaultChatModel || '').trim())
    ? String(payload.defaultChatModel).trim()
    : nextModelPolicy.defaultModel || '';
  row.replyStyleRules = config.replyStyleRules;
  row.modelPolicy = nextModelPolicy;
  row.contextPolicy = config.contextPolicy;
  row.retrievalPolicy = config.retrievalPolicy;
  row.toolPolicy = config.toolPolicy;
  row.knowledgeDocumentBindings = normalizeVersionKnowledgeDocumentBindings(
    config.knowledgeDocumentBindings,
    listLocalManageableKnowledgeBaseIds(store, user, payload.knowledgeBaseIds ?? current.knowledgeBaseIds)
  );
  row.validationStatus = 'pending';
  row.validationSummary = null;
  syncLocalVersionKnowledgeBases(store, versionId, listLocalManageableKnowledgeBaseIds(store, user, payload.knowledgeBaseIds ?? current.knowledgeBaseIds));
  agent.updatedAt = Date.now();
  return getLocalAgentVersionById(store, versionId);
};

const listLocalKnowledgeBases = (store, user) =>
  (store.knowledgeBases || [])
    .filter((item) => isSuperAdminUser(user) || item.ownerUserId === user.id)
    .map((item) => {
      const owner = (store.users || []).find((userItem) => userItem.id === item.ownerUserId);
      return {
        ...item,
        ownerDisplayName: owner?.displayName || owner?.username || '',
        documentCount: (store.knowledgeDocuments || []).filter((doc) => doc.knowledgeBaseId === item.id).length,
        boundAgentCount: new Set((store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId === item.id).map((row) => row.agentVersionId)).size,
      };
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

const getLocalKnowledgeBaseById = (store, knowledgeBaseId) => {
  const item = (store.knowledgeBases || []).find((row) => row.id === knowledgeBaseId);
  if (!item) return null;
  const owner = (store.users || []).find((userItem) => userItem.id === item.ownerUserId);
  return {
    ...item,
    ownerDisplayName: owner?.displayName || owner?.username || '',
    documentCount: (store.knowledgeDocuments || []).filter((doc) => doc.knowledgeBaseId === item.id).length,
    boundAgentCount: new Set((store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId === item.id).map((row) => row.agentVersionId)).size,
  };
};

const createLocalKnowledgeBase = (store, user, payload) => {
  const item = {
    id: createEntityId(),
    name: String(payload.name || '未命名知识库').slice(0, 120),
    description: String(payload.description || '').slice(0, 5000),
    department: String(payload.department || '未分组').slice(0, 120),
    ownerUserId: user.id,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.knowledgeBases.push(item);
  return listLocalKnowledgeBases(store, user).find((row) => row.id === item.id) || null;
};

const updateLocalKnowledgeBase = (store, user, knowledgeBaseId, payload) => {
  const item = (store.knowledgeBases || []).find((row) => row.id === knowledgeBaseId);
  if (!item || !canManageOwnedResource(user, item.ownerUserId)) return null;
  if (typeof payload.name === 'string') item.name = payload.name.slice(0, 120);
  if (typeof payload.description === 'string') item.description = payload.description.slice(0, 5000);
  if (typeof payload.department === 'string') item.department = payload.department.slice(0, 120);
  if (payload.status) item.status = normalizeKnowledgeBaseStatus(payload.status);
  item.updatedAt = Date.now();
  return listLocalKnowledgeBases(store, user).find((row) => row.id === knowledgeBaseId) || null;
};

const deleteLocalKnowledgeBase = (store, user, knowledgeBaseId) => {
  const itemIndex = (store.knowledgeBases || []).findIndex((row) => row.id === knowledgeBaseId);
  if (itemIndex < 0) return 0;
  const item = store.knowledgeBases[itemIndex];
  if (!canManageOwnedResource(user, item.ownerUserId)) return 0;
  store.knowledgeBases.splice(itemIndex, 1);
  store.knowledgeDocuments = (store.knowledgeDocuments || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  return 1;
};

const listLocalKnowledgeDocuments = (store, user, knowledgeBaseId) => {
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return [];
  return (store.knowledgeDocuments || [])
    .filter((item) => item.knowledgeBaseId === knowledgeBaseId)
    .map((item) => ({
      ...item,
      chunkStrategy: normalizeKnowledgeChunkStrategyValue(item.chunkStrategy),
      normalizationEnabled: Boolean(item.normalizationEnabled),
      normalizedText: String(item.normalizedText || ''),
      normalizationError: String(item.normalizationError || ''),
      normalizedStatus: normalizeKnowledgeNormalizedStatus(item.normalizedStatus),
      chunkSource: normalizeKnowledgeChunkSource(item.chunkSource),
    }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
};

const createLocalKnowledgeDocument = async (store, user, payload) => {
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === payload.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = String(payload.rawText || '').trim();
  const chunkStrategy = normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = Boolean(payload.normalizationEnabled);
  const systemSettings = getLocalSystemSettings(store);
  const normalizationResult = normalizationEnabled
    ? { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: `本地 JSON 模式不执行 AI 规范整理，请切到服务端模式；当前将按 ${resolveConfiguredAnalysisModel(systemSettings) || '自动模型'} 的规则回退为原文切片。` }
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const chunkEmbeddings = await embedChunkContentsSafe(chunks);
  const documentId = createEntityId();
  const now = Date.now();
  const document = {
    id: documentId,
    knowledgeBaseId: knowledgeBase.id,
    title: String(payload.title || '未命名文档').slice(0, 255),
    sourceType: normalizeSourceType(payload.sourceType),
    chunkStrategy,
    rawText,
    normalizationEnabled,
    normalizedText: normalizationResult.normalizedText,
    normalizationError: normalizationResult.normalizationError,
    normalizedStatus: normalizationResult.normalizedStatus,
    chunkSource: normalizationResult.chunkSource,
    parseStatus: 'parsed',
    chunkCount: chunks.length,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  store.knowledgeDocuments.push(document);
  chunks.forEach((content, index) => {
    store.knowledgeChunks.push({
      id: createEntityId(),
      documentId,
      knowledgeBaseId: knowledgeBase.id,
      chunkIndex: index,
      sourceType: document.sourceType,
      content,
      tokenEstimate: estimateTokenCount(content),
      embedding: chunkEmbeddings[index] || null,
      documentTitle: document.title,
      createdAt: now,
    });
  });
  knowledgeBase.updatedAt = now;
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    appendLocalLog(store, {
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${document.title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  return document;
};

const updateLocalKnowledgeDocument = async (store, user, documentId, payload) => {
  const document = (store.knowledgeDocuments || []).find((item) => item.id === documentId);
  if (!document) return null;
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === document.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = typeof payload.rawText === 'string' ? String(payload.rawText).trim() : String(document.rawText || '');
  const title = typeof payload.title === 'string' ? String(payload.title).slice(0, 255) : String(document.title || '未命名文档');
  const sourceType = typeof payload.sourceType === 'string' ? normalizeSourceType(payload.sourceType) : normalizeSourceType(document.sourceType);
  const chunkStrategy = payload.chunkStrategy === undefined ? normalizeKnowledgeChunkStrategyValue(document.chunkStrategy) : normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = payload.normalizationEnabled === undefined ? Boolean(document.normalizationEnabled) : Boolean(payload.normalizationEnabled);
  const systemSettings = getLocalSystemSettings(store);
  const normalizationResult = normalizationEnabled
    ? { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: `本地 JSON 模式不执行 AI 规范整理，请切到服务端模式；当前将按 ${resolveConfiguredAnalysisModel(systemSettings) || '自动模型'} 的规则回退为原文切片。` }
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const chunkEmbeddings = await embedChunkContentsSafe(chunks);
  const now = Date.now();
  document.title = title;
  document.sourceType = sourceType;
  document.chunkStrategy = chunkStrategy;
  document.rawText = rawText;
  document.normalizationEnabled = normalizationEnabled;
  document.normalizedText = normalizationResult.normalizedText;
  document.normalizationError = normalizationResult.normalizationError;
  document.normalizedStatus = normalizationResult.normalizedStatus;
  document.chunkSource = normalizationResult.chunkSource;
  document.parseStatus = 'parsed';
  document.chunkCount = chunks.length;
  document.updatedAt = now;
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((item) => item.documentId !== documentId);
  chunks.forEach((content, index) => {
    store.knowledgeChunks.push({
      id: createEntityId(),
      documentId,
      knowledgeBaseId: knowledgeBase.id,
      chunkIndex: index,
      sourceType,
      content,
      tokenEstimate: estimateTokenCount(content),
      embedding: chunkEmbeddings[index] || null,
      documentTitle: title,
      createdAt: now,
    });
  });
  knowledgeBase.updatedAt = now;
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    appendLocalLog(store, {
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  return document;
};

const deleteLocalKnowledgeDocument = (store, user, documentId) => {
  const documentIndex = (store.knowledgeDocuments || []).findIndex((item) => item.id === documentId);
  if (documentIndex < 0) return 0;
  const document = store.knowledgeDocuments[documentIndex];
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === document.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return 0;
  store.knowledgeDocuments.splice(documentIndex, 1);
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((item) => item.documentId !== documentId);
  knowledgeBase.updatedAt = Date.now();
  return 1;
};

const listLocalKnowledgeChunksForVersion = (store, version) => {
  const knowledgeBaseIds = cleanKnowledgeBaseIds(version?.knowledgeBaseIds);
  if (knowledgeBaseIds.length === 0) return [];
  return knowledgeBaseIds.flatMap((knowledgeBaseId) => {
    const availableDocumentIds = (store.knowledgeDocuments || [])
      .filter((document) => document.knowledgeBaseId === knowledgeBaseId)
      .map((document) => document.id);
    const enabledDocumentIds = resolveEnabledKnowledgeDocumentIds(version, knowledgeBaseId, availableDocumentIds);
    if (enabledDocumentIds.size === 0) return [];
    return (store.knowledgeChunks || []).filter((chunk) =>
      chunk.knowledgeBaseId === knowledgeBaseId && enabledDocumentIds.has(chunk.documentId)
    );
  });
};

const runLocalAgentConversation = async ({
  store,
  user,
  agent,
  version,
  priorMessages,
  currentMessage,
  sessionId = null,
  selectedModelOverride = '',
  attachments = [],
  reasoningLevel = null,
  webSearchEnabled = false,
  onProgress = null,
}) => {
  const shouldRetrieve = shouldUseKnowledgeRetrieval(currentMessage, version.retrievalPolicy, version.knowledgeBaseIds);
  const hasKnowledgeBase = Array.isArray(version.knowledgeBaseIds) && version.knowledgeBaseIds.length > 0 && Boolean(version.retrievalPolicy?.enabled);
  const candidateChunks = (shouldRetrieve || hasKnowledgeBase) ? listLocalKnowledgeChunksForVersion(store, version) : [];
  const allPrior = Array.isArray(priorMessages) ? priorMessages : [];
  const maxRounds = Number(version.contextPolicy.maxHistoryRounds || 6);
  const summaryThreshold = Number(version.contextPolicy.summaryTriggerThreshold || 10);
  const recentCount = maxRounds * 2;
  let summary = '';
  let recentSlice = allPrior;
  if (allPrior.length > summaryThreshold * 2) {
    const olderMessages = allPrior.slice(0, -recentCount);
    summary = buildConversationSummary(olderMessages, Number(version.contextPolicy.maxSummaryChars || 1200));
    recentSlice = allPrior.slice(-recentCount);
  } else {
    recentSlice = allPrior.slice(-recentCount);
  }
  const recentMessages = recentSlice.map((message) => ({
    role: message.role,
    content: Array.isArray(message.attachments) && message.attachments.length > 0
      ? buildChatMessageContent(message.content, message.attachments.filter((a) => a?.kind === 'image'))
      : message.content,
  }));
  const { text: inlinedMessage, attachments: remainingAttachments } = await inlineTextAttachments(null, currentMessage, attachments);
  const messages = buildAgentPromptMessages({
    systemPrompt: version.systemPrompt,
    summary,
    recentMessages,
    knowledgeChunks: [],
    userMessage: inlinedMessage,
    hasKnowledgeBase,
  });
  if (messages.length > 0) {
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: buildChatMessageContent(inlinedMessage, remainingAttachments),
    };
  }
  const selectedModel = String(selectedModelOverride || (hasKnowledgeBase ? version.modelPolicy.defaultModel : version.modelPolicy.cheapModel) || '').trim();
  const fallbackModels = resolveChatFallbackModels(version, selectedModel);
  const startedAt = Date.now();
  let content;
  let usedChunks = [];
  let output = null;
  if (hasKnowledgeBase) {
    const agenticResult = await runAgenticRetrievalLoop({
      userId: user.id,
      initialMessages: messages,
      currentMessage,
      selectedModel,
      fallbackModels,
      reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
      webSearchEnabled: Boolean(webSearchEnabled),
      candidateChunks,
      retrievalPolicy: version.retrievalPolicy,
    });
    content = sanitizeAgentAssistantContent(agenticResult.content);
    usedChunks = agenticResult.allUsedChunks;
  } else {
    onProgress?.({ stage: 'thinking', round: 1 });
    output = await executeProviderJobWithManagedAssetScrub({
      userId: user.id,
      taskType: 'kie_chat',
      payload: {
        messages,
        model: selectedModel,
        fallbackModels,
        reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
        webSearchEnabled: Boolean(webSearchEnabled),
      },
    }, process.env, new AbortController().signal);
    content = sanitizeAgentAssistantContent(output?.result?.content);
  }
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(content);
  return {
    content,
    selectedModel,
    usedRetrieval: usedChunks.length > 0,
    knowledgeChunks: usedChunks,
    retrievalSummary: usedChunks.map((chunk) => ({ documentTitle: chunk.documentTitle, sourceType: chunk.sourceType, preview: String(chunk.content || '').slice(0, 120) })),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs: Date.now() - startedAt,
    estimatedCost: estimateCostByTokens(promptTokens, completionTokens),
    sessionId,
    userId: user.id,
    agentId: agent.id,
  };
};

const extractJsonObject = (value) => {
  const source = String(value || '').trim();
  if (!source) return null;
  const fencedMatch = source.match(/```json\s*([\s\S]*?)```/i) || source.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] || source;
  const startIndex = candidate.indexOf('{');
  const endIndex = candidate.lastIndexOf('}');
  if (startIndex < 0 || endIndex <= startIndex) return null;
  try {
    return JSON.parse(candidate.slice(startIndex, endIndex + 1));
  } catch {
    return null;
  }
};

const buildConversationImageCatalog = (attachments = [], priorMessages = [], maxReferenceImages = 10) => {
  const catalog = [];
  const seenUrls = new Set();
  const pushImage = (item) => {
    const url = normalizeAgentImageUrl(item?.url);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    catalog.push({
      index: catalog.length + 1,
      label: `图${catalog.length + 1}`,
      name: String(item?.name || `图${catalog.length + 1}`),
      url,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      source: item?.source || 'history_attachment',
    });
  };

  (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item?.kind === 'image' && item?.url)
    .forEach((item) => pushImage({
      name: item.name,
      url: item.url,
      mimeType: item.mimeType,
      source: 'current_upload',
    }));

  (Array.isArray(priorMessages) ? priorMessages : []).forEach((message) => {
    if (catalog.length >= maxReferenceImages) return;
    if (message?.role === 'user' && Array.isArray(message?.attachments)) {
      message.attachments
        .filter((item) => item?.kind === 'image' && item?.url)
        .forEach((item) => pushImage({
          name: item.name || '历史上传图',
          url: item.url,
          mimeType: item.mimeType,
          source: 'history_attachment',
        }));
    }
    const resultUrls = Array.isArray(message?.metadata?.imageResultUrls)
      ? message.metadata.imageResultUrls.map((item) => normalizeAgentImageUrl(item)).filter(Boolean)
      : [];
    resultUrls.forEach((url, index) => pushImage({
      name: `历史生成图${index + 1}`,
      url,
      source: 'previous_result',
    }));
    if (message?.role === 'assistant' && Array.isArray(message?.attachments)) {
      message.attachments
        .filter((item) => item?.kind === 'image' && item?.url)
        .forEach((item, index) => pushImage({
          name: item.name || `历史生成图${index + 1}`,
          url: item.url,
          mimeType: item.mimeType,
          source: 'previous_result',
        }));
    }
  });

  return catalog.slice(0, maxReferenceImages).map((item, index) => ({
    ...item,
    index: index + 1,
    label: `图${index + 1}`,
  }));
};

const buildImagePromptReferenceText = (imageReferences = [], preferredInputImageUrls = []) => {
  const refs = Array.isArray(imageReferences) ? imageReferences : [];
  const preferredUrls = Array.isArray(preferredInputImageUrls)
    ? preferredInputImageUrls.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (preferredUrls.length === 0) return '';
  const lines = preferredUrls.map((url, index) => {
    const matchedRef = refs.find((item) => String(item?.url || '').trim() === url);
    const labelSuffix = matchedRef?.name ? `，说明=${matchedRef.name}` : '';
    const roleSuffix = matchedRef?.role ? `，角色=${matchedRef.role}` : '';
    return `图${index + 1}：URL=${url}${labelSuffix}${roleSuffix}`;
  });
  return `输入图顺序说明（必须严格按下列顺序理解）\n${lines.join('\n')}`;
};

const extractExplicitImageReferenceIndexes = (text = '') => {
  const source = String(text || '');
  const matches = source.matchAll(/图\s*([1-9]\d*)/g);
  const indexes = [];
  const seen = new Set();
  for (const match of matches) {
    const value = Number(match?.[1] || 0);
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) continue;
    seen.add(value);
    indexes.push(value);
  }
  return indexes;
};

const extractDirectionalImageReferenceIndexes = ({ text = '', imageReferences = [] }) => {
  const refs = Array.isArray(imageReferences) ? imageReferences : [];
  const normalizedText = String(text || '');
  const indexes = [];
  const seen = new Set();
  const pushIndex = (value) => {
    const numericValue = Number(value || 0);
    if (!Number.isInteger(numericValue) || numericValue <= 0 || seen.has(numericValue)) return;
    seen.add(numericValue);
    indexes.push(numericValue);
  };
  const currentUploads = refs.filter((item) => item?.source === 'current_upload');
  const previousResults = refs.filter((item) => item?.source === 'previous_result');

  const currentUploadMatches = Array.from(String(text || '').matchAll(/(?:刚上传|上传的|本轮上传的).*?第\s*([1-9]\d*)\s*张/g));
  currentUploadMatches.forEach((match) => {
    const order = Number(match?.[1] || 0);
    const matchedReference = currentUploads[order - 1];
    if (matchedReference?.index) pushIndex(matchedReference.index);
  });

  const previousResultMatches = Array.from(String(text || '').matchAll(/第\s*([1-9]\d*)\s*张(?:生成图|结果图|出图)/g));
  previousResultMatches.forEach((match) => {
    const order = Number(match?.[1] || 0);
    const matchedReference = previousResults[order - 1];
    if (matchedReference?.index) pushIndex(matchedReference.index);
  });

  if (/上一张|上一版|最近一张|刚才那张|刚才那版|上次生成|上一张生成图/.test(normalizedText)) {
    const latestPreviousResult = previousResults.at(-1);
    if (latestPreviousResult?.index) pushIndex(latestPreviousResult.index);
  }

  if (/刚上传的图|刚上传图片|最新上传|本轮上传图/.test(normalizedText)) {
    const latestCurrentUpload = currentUploads.at(-1);
    if (latestCurrentUpload?.index) pushIndex(latestCurrentUpload.index);
  }

  return indexes;
};

const selectRelevantImageReferences = ({ imageReferences = [], userMessage = '', maxInputImages = 1, editPreferenceHints = null }) => {
  const refs = Array.isArray(imageReferences) ? imageReferences : [];
  const limit = Math.max(1, Number(maxInputImages || 1));

  const explicitIndexes = extractExplicitImageReferenceIndexes(userMessage);
  const directionalIndexes = extractDirectionalImageReferenceIndexes({ text: userMessage, imageReferences: refs });
  const requestedIndexes = Array.from(new Set([...explicitIndexes, ...directionalIndexes]));
  const hasRequestedIndexes = requestedIndexes.length > 0;
  if (refs.length <= limit && !hasRequestedIndexes) return refs.slice(0, limit);
  const selected = [];
  const selectedUrls = new Set();
  const pushReference = (item) => {
    const url = String(item?.url || '').trim();
    if (!url || selectedUrls.has(url) || selected.length >= limit) return;
    selectedUrls.add(url);
    selected.push(item);
  };

  const refByIndex = new Map(refs.map((item) => [Number(item?.index || 0), item]));
  requestedIndexes.forEach((index) => pushReference(refByIndex.get(index)));

  const currentUploads = refs.filter((item) => item?.source === 'current_upload');
  const previousResults = refs.filter((item) => item?.source === 'previous_result');
  const historyAttachments = refs.filter((item) => item?.source === 'history_attachment');
  const fallbackCandidates = editPreferenceHints?.preferPreviousResultAsPrimary
    ? [
      ...previousResults.slice(-1),
      ...currentUploads,
      ...historyAttachments.slice(-1),
    ]
    : [
      ...currentUploads,
      ...previousResults.slice(-1),
      ...historyAttachments.slice(-1),
    ];

  if (!hasRequestedIndexes || selected.length === 0) {
    fallbackCandidates.forEach((item) => pushReference(item));
  }

  if (selected.length === 0) {
    fallbackCandidates.forEach((item) => pushReference(item));
  }

  return selected
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      index: index + 1,
      label: `图${index + 1}`,
    }));
};

const buildImageConversationTextContext = (priorMessages = [], maxRounds = 6, summary = '') => {
  const scopedMessages = (Array.isArray(priorMessages) ? priorMessages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .slice(-Math.max(2, Number(maxRounds || 6) * 2));

  const lines = scopedMessages.map((message) => {
    const roleLabel = message.role === 'assistant' ? '助手' : '用户';
    const requestMode = String(message?.metadata?.requestMode || '').trim();
    const modeLabel = requestMode === 'image_generation' ? '生图' : '对话';
    const content = String(message?.content || '').trim();
    if (!content) return '';
    return `${roleLabel}（${modeLabel}）：${content}`;
  }).filter(Boolean);

  return {
    summary: String(summary || '').trim(),
    recentText: lines.join('\n'),
  };
};

const buildImageEditPreferenceHints = ({ userMessage = '', imageReferences = [] }) => {
  const text = String(userMessage || '').trim();
  const refs = Array.isArray(imageReferences) ? imageReferences : [];
  const previousResults = refs.filter((item) => item?.source === 'previous_result' && item?.url);
  const currentUploads = refs.filter((item) => item?.source === 'current_upload' && item?.url);
  const hasPreviousResult = previousResults.length > 0;
  const hasCurrentUpload = currentUploads.length > 0;
  const iterativeEditIntent = /(继续|调整|优化|修改|改一下|改成|不满意|上一张|上一版|刚才|基于|沿用)/.test(text);
  const layoutStyleIntent = /(参考|参照|按这个|像这个|版式|排版|布局|框架|结构|风格|样式|色调)/.test(text);
  const replaceSubjectIntent = /(换成|替换成|改成同款|主体换成|内容换成|商品换成)/.test(text);
  const preferPreviousResultAsPrimary = hasPreviousResult && hasCurrentUpload && !replaceSubjectIntent && (iterativeEditIntent || layoutStyleIntent);
  return {
    preferPreviousResultAsPrimary,
    previousResultUrls: previousResults.map((item) => String(item.url || '').trim()).filter(Boolean),
    currentUploadUrls: currentUploads.map((item) => String(item.url || '').trim()).filter(Boolean),
  };
};

const buildImageGenerationAnalysisMessages = ({ agent, version, userMessage, imageReferences = [], selectedImageModel, maxInputImages, knowledgeChunks = [], conversationSummary = '', recentConversationText = '', editPreferenceHints = null }) => {
  const refsText = imageReferences.length > 0
    ? imageReferences.map((item) => `${item.label}：${item.name}，来源=${item.source}，URL=${item.url}`).join('\n')
    : '本轮没有上传参考图。';
  const referenceImageItems = imageReferences
    .map((item) => String(item?.url || '').trim())
    .filter(Boolean)
    .map((url) => ({
      type: 'image_url',
      image_url: { url },
    }));
  const knowledgeText = Array.isArray(knowledgeChunks) && knowledgeChunks.length > 0
    ? knowledgeChunks.map((item, index) => `规则${index + 1}（${item.documentTitle || item.sourceType || '知识片段'}）：${String(item.content || '').trim()}`).join('\n\n')
    : '';
  const conversationText = recentConversationText ? `最近对话上下文：\n${recentConversationText}` : '';
  const summaryText = conversationSummary ? `会话摘要：\n${conversationSummary}` : '';
  const userAnalysisText = `用户需求：${userMessage}\n\n图片输入：\n${refsText}`;
  return [
    {
      role: 'system',
      content: [
        version.systemPrompt || `你是${agent.name}的图像生成策划助手。`,
        '你的任务是把用户需求整理成严格可执行的生图参数 JSON。',
        `当前生图模型：${selectedImageModel}。`,
        `最多允许输入图片数量：${maxInputImages}。`,
        '图片引用规则：你会拿到当前会话可用的参考图目录，必须严格按目录中的图1、图2、图3……理解，不得自行改号。',
        '若本轮有新上传图，新上传图会优先排在前面；其后才是历史上传图、历史生成图。',
        '如果用户说“把图1的xx换到图2”“参考图3色调”，必须在 imageReferences、inputImageUrls 和 reasoningSummary 里明确对应关系。',
        '结构化字段是后端提交生图的唯一依据：凡是 image_to_image、image_edit、image_refinement、局部修改、替换、保持原图、参考图、基于图1/图2 的任务，inputImageUrls 绝不能返回空数组。',
        'inputImageUrls 必须使用“图片输入”目录中列出的原始 URL，不要使用模型分析过程中看到的临时上传 URL；imageReferences 必须填写对应的 index 和 role。',
        '如果只把图片 URL 写进 prompt 文本，但 inputImageUrls 或 imageReferences 没有对应图片，后端会判定为无效改图计划并停止提交。',
        '如果用户没有明确指定使用哪张图，你要根据当前需求自动判断最合适的参考图，并在 reasoningSummary 里说明最终采用了哪些图。',
        '你必须结合最近几轮对话来理解“继续调整”“按上一版修改”“保持刚才风格”这类指代，不要只看当前一句话。',
        '比例规则：默认 size 必须为 auto。只有用户明确指定了目标比例，或者明确表达“当前比例不对、需要改成长图/横图/方图”等比例修正诉求时，才允许修改 size。',
        '如果用户没有提比例，就算你能从图片里看出比例，也不要擅自把 size 改成 1:1、4:5、16:9 等固定比例。',
        editPreferenceHints?.preferPreviousResultAsPrimary
          ? '当前场景是继续调整上一张生成图，并参考本轮新上传图的版式/风格。你必须优先把最近一张历史生成图作为主编辑对象，把本轮新上传图作为版式/风格参考。不得因为上传了新的参考图，就直接把新图当成新的主体内容来源，除非用户明确要求替换主体。'
          : '',
        knowledgeText ? '下面会提供与当前生图任务相关的知识库规则。你必须优先遵守这些规则；若用户需求与规则冲突，按规则执行，并在 reasoningSummary 里说明。' : '',
        '只输出 JSON，不要输出解释文字。',
        'JSON 字段必须包含：taskType, selectedImageModel, size, transparentBackground, inputImageUrls, imageReferences, prompt, reasoningSummary。',
      ].filter(Boolean).join('\n'),
    },
    ...(summaryText ? [{ role: 'system', content: summaryText }] : []),
    ...(conversationText ? [{ role: 'system', content: conversationText }] : []),
    ...(knowledgeText ? [{ role: 'system', content: `知识库参考：\n${knowledgeText}` }] : []),
    {
      role: 'user',
      content: referenceImageItems.length > 0
        ? [
          { type: 'text', text: userAnalysisText },
          ...referenceImageItems,
        ]
        : userAnalysisText,
    },
  ];
};

const buildFallbackImageAnalysisPlan = ({ userMessage = '', imageReferences = [], selectedImageModel = '', maxInputImages = 1 }) => {
  const usableRefs = (Array.isArray(imageReferences) ? imageReferences : [])
    .filter((item) => item?.url)
    .slice(0, Math.max(Number(maxInputImages || 1), 1));
  const refsText = usableRefs.length > 0
    ? usableRefs.map((item) => `${item.label || `图${item.index || ''}`}=${item.url}`).join('\n')
    : '无';
  const prompt = [
    '请严格按用户需求执行图片生成或编辑。',
    `用户需求：${String(userMessage || '').trim()}`,
    `可用图片引用：\n${refsText}`,
    '保持未被要求修改的主体、文字、排版、风格和比例关系，避免自行添加用户未要求的新元素。',
  ].join('\n');
  return {
    taskType: usableRefs.length > 0 ? 'edit_image' : 'new_image',
    selectedImageModel,
    size: 'auto',
    transparentBackground: false,
    inputImageUrls: usableRefs.map((item) => item.url),
    imageReferences: usableRefs.map((item) => ({
      index: item.index,
      label: item.label,
      role: item.index === 1 ? 'primary_edit_source' : 'reference',
    })),
    prompt,
    reasoningSummary: '已按用户原始需求和图片引用直接整理生图参数。',
  };
};

const detectExplicitAspectRatioInstruction = (text = '') => /(?:^|[^\d])(1:1|3:4|4:3|4:5|9:16|16:9)(?:$|[^\d])|正方形|方图|竖图|横图|长图|比例改成|做成.*比例|尺寸改成/.test(String(text || ''));

const hasAspectRatioCorrectionIntent = (text = '') => /比例.*(不对|不太对|不合适|有问题|改一下|调整一下)|尺寸.*(不对|不太对|不合适|有问题)|改比例|调比例/.test(String(text || ''));

const enrichRuntimeError = (error, extras = {}) => {
  if (!error || typeof error !== 'object' || !extras || typeof extras !== 'object') return error;
  Object.entries(extras).forEach(([key, value]) => {
    if ((error[key] === undefined || error[key] === null || error[key] === '') && value !== undefined) {
      error[key] = value;
    }
  });
  return error;
};

const buildImageConversationResult = async ({ user, agent, version, priorMessages, currentMessage, sessionId = null, selectedModelOverride = '', attachments = [], systemSettings = {}, knowledgeChunks = [], conversationSummary = '', onImageReady = null, localAssetLockHeld = false, runId = '', clientRequestId = '' }) => {
  const imageCapability = getImageModelCapability(version?.modelPolicy?.multimodalModel);
  const selectedImageModel = String(version?.modelPolicy?.multimodalModel || '').trim();
  if (!version?.modelPolicy?.imageGenerationEnabled || !selectedImageModel || !imageCapability) {
    throw new Error('当前智能体未启用生图模型');
  }
  const imageReferences = await filterAvailableConversationImageReferences(buildConversationImageCatalog(
    attachments,
    priorMessages,
    Math.max(Number(imageCapability.maxInputImages || 1), 10)
  ), user.id);
  const conversationContext = buildImageConversationTextContext(
    priorMessages,
    Number(version?.contextPolicy?.maxHistoryRounds || 6),
    conversationSummary
  );
  const editPreferenceHints = buildImageEditPreferenceHints({
    userMessage: currentMessage,
    imageReferences,
  });
  const relevantImageReferences = selectRelevantImageReferences({
    imageReferences,
    userMessage: currentMessage,
    maxInputImages: Number(imageCapability.maxInputImages || 1),
    editPreferenceHints,
  });
  const analysisMessages = buildImageGenerationAnalysisMessages({
    agent,
    version,
    userMessage: currentMessage,
    imageReferences: relevantImageReferences,
    selectedImageModel,
    maxInputImages: Number(imageCapability.maxInputImages || 1),
    knowledgeChunks,
    conversationSummary: conversationContext.summary,
    recentConversationText: conversationContext.recentText,
    editPreferenceHints,
  });
  const analysisModel = resolveConfiguredAnalysisModel(
    systemSettings,
    selectedModelOverride,
    version.defaultChatModel,
    version.modelPolicy.defaultModel,
    version.modelPolicy.cheapModel
  );
  const analysisFallbackModels = resolveImageAnalysisFallbackModels(version, analysisModel);
  const startedAt = Date.now();
  let analysisOutput;
  let analysisError = null;
  try {
    analysisOutput = await executeProviderJobWithManagedAssetScrub({
      userId: user.id,
      taskType: 'kie_chat',
      payload: { messages: analysisMessages, model: analysisModel, fallbackModels: analysisFallbackModels },
    }, process.env, new AbortController().signal);
  } catch (error) {
    analysisError = enrichRuntimeError(error, {
      providerStage: error?.providerStage || 'analysis',
      providerStatus: error?.providerStatus || 'failed',
      providerMessage: error?.providerMessage || error?.message || '生图分析失败',
      selectedModel: analysisModel,
      inputImageCount: Number(relevantImageReferences.length || 0),
      inputImageUrls: relevantImageReferences.map((item) => item.url).filter(Boolean),
      usedImageReferenceUrls: relevantImageReferences.map((item) => item.url).filter(Boolean),
    });
  }
  const analysisContent = String(analysisOutput?.result?.content || '').trim();
  const parsed = analysisError
    ? buildFallbackImageAnalysisPlan({
        userMessage: currentMessage,
        imageReferences: relevantImageReferences,
        selectedImageModel,
        maxInputImages: Number(imageCapability.maxInputImages || 1),
      })
    : (extractJsonObject(analysisContent) || {});
  const normalizedRefs = relevantImageReferences.map((item) => ({
    index: item.index,
    label: item.label,
    name: item.name,
    url: item.url,
    mimeType: item.mimeType,
    source: item.source,
    role: Array.isArray(parsed.imageReferences)
      ? String(parsed.imageReferences.find((ref) => Number(ref?.index || 0) === item.index)?.role || '')
      : '',
  }));
  const availableManagedReferenceUrls = new Set(
    normalizedRefs
      .map((item) => String(item?.url || '').trim())
      .filter((url) => url && isManagedAssetUrl(url))
  );
  const parsedInputImageUrls = Array.isArray(parsed.inputImageUrls)
    ? parsed.inputImageUrls
      .map((item) => normalizeAgentImageUrl(item))
      .filter((url) => !isManagedAssetUrl(url) || availableManagedReferenceUrls.has(url))
      .filter(Boolean)
    : null;
  const inputImageDetails = resolveAgentImagePlanInputUrlDetails({
    parsed: {
      ...parsed,
      ...(parsedInputImageUrls ? { inputImageUrls: parsedInputImageUrls } : {}),
    },
    normalizedRefs,
    imageCapability,
    currentMessage,
  });
  const inputImageUrls = inputImageDetails.urls;
  const preferredInputImageUrls = filterAvailableAgentImageUrls(
    editPreferenceHints.preferPreviousResultAsPrimary
      ? Array.from(new Set([
      ...editPreferenceHints.previousResultUrls.slice(-1),
      ...editPreferenceHints.currentUploadUrls,
      ...inputImageUrls,
    ]))
      : inputImageUrls,
    normalizedRefs,
    Number(imageCapability.maxInputImages || 1)
  );
  if (shouldRequireAgentImageInput({ parsed, currentMessage }) && preferredInputImageUrls.length === 0) {
    const error = new Error('改图任务没有可用输入图，已停止提交，避免被生图模型当作文生图执行。');
    error.code = 'missing_image_input';
    error.providerStage = 'input_prepare';
    error.providerStatus = 'failed';
    error.providerMessage = error.message;
    error.selectedModel = selectedImageModel;
    error.inputImageCount = 0;
    error.inputImageUrls = [];
    error.usedImageReferenceUrls = [];
    throw error;
  }
  const promptPrefix = editPreferenceHints.preferPreviousResultAsPrimary
    ? '以最近一张历史生成图为主编辑对象，保留主体内容连续性；其余输入图仅作为版式、排版、风格参考，不替换主体商品。\n'
    : '';
  const promptReferenceText = buildImagePromptReferenceText(normalizedRefs, preferredInputImageUrls);
  const finalPrompt = `${promptPrefix}${promptReferenceText}\n${String(parsed.prompt || currentMessage).trim()}`.trim();
  const usedImageReferences = preferredInputImageUrls.map((url) => {
    const normalizedUrl = normalizeAgentImageUrl(url);
    return normalizedRefs.find((item) => normalizeAgentImageUrl(item.url) === normalizedUrl);
  }).filter(Boolean);
  const requestedAspectRatio = String(parsed.size || '').trim();
  const hasExplicitAspectRatioInstruction = detectExplicitAspectRatioInstruction(currentMessage);
  const shouldKeepAutoAspectRatio = !hasExplicitAspectRatioInstruction && !hasAspectRatioCorrectionIntent(currentMessage);
  const normalizedAspectRatio = shouldKeepAutoAspectRatio
    ? 'auto'
    : (imageCapability.supportedSizes || []).includes(requestedAspectRatio)
      ? requestedAspectRatio
      : (imageCapability.defaultSize || 'auto');
  const normalizedResolution = String(imageCapability.defaultResolution || '1K').trim() || '1K';
  let imageOutput;
  try {
    imageOutput = await executeProviderJobWithManagedAssetScrub({
      userId: user.id,
      taskType: 'kie_image',
      payload: {
        imageUrls: preferredInputImageUrls,
        prompt: finalPrompt,
        model: selectedImageModel,
        aspectRatio: normalizedAspectRatio,
        resolution: normalizedResolution,
      },
    }, process.env, new AbortController().signal);
  } catch (error) {
    throw enrichRuntimeError(error, {
      providerStage: error?.providerStage || 'image_generation',
      providerStatus: error?.providerStatus || 'failed',
      providerMessage: error?.providerMessage || error?.message || '图像生成失败',
      selectedModel: selectedImageModel,
      inputImageCount: Number(preferredInputImageUrls.length || 0),
      inputImageUrls: preferredInputImageUrls,
      usedImageReferenceUrls: usedImageReferences.map((item) => item?.url).filter(Boolean),
    });
  }
  const imageUrl = String(imageOutput?.result?.imageUrl || '').trim();
  const persistedImageUrl = await persistRuntimeRemoteAssetIfEnabled({
    userId: user.id,
    moduleName: 'agent_center',
    assetType: 'result',
    remoteUrl: imageUrl,
    originalName: `${selectedImageModel || 'image_result'}.png`,
    provider: isMaxForAiImageModel(selectedImageModel) ? 'maxforai' : 'kie',
    jobId: normalizeStoredAssetJobId(imageOutput?.providerTaskId || runId || clientRequestId),
    localLockHeld: localAssetLockHeld,
  });
  const promptTokens = analysisMessages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(analysisContent);
  const content = [
    '已根据你的需求完成生图。',
    `模型：${selectedImageModel}`,
    normalizedRefs.length > 0 ? `输入图片：${normalizedRefs.map((item) => `${item.label}${item.role ? `(${item.role})` : ''}`).join('、')}` : '输入图片：无',
    `参数摘要：${String(parsed.reasoningSummary || '已按当前需求自动整理图片关系、构图与风格要求。')}`,
    `Prompt：${finalPrompt}`,
  ].join('\n');
  const result = {
    content,
    selectedModel: selectedImageModel,
    usedRetrieval: knowledgeChunks.length > 0,
    knowledgeChunks,
    retrievalSummary: knowledgeChunks.map((chunk) => ({
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      preview: String(chunk.content || '').slice(0, 120),
    })),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs: Date.now() - startedAt,
    estimatedCost: estimateCostByTokens(promptTokens, completionTokens),
    sessionId,
    userId: user.id,
    agentId: agent.id,
    requestType: 'image_generation',
    providerTaskId: String(imageOutput?.providerTaskId || '').trim(),
    providerStage: String(imageOutput?.providerStage || 'completed').trim(),
    providerStatus: String(imageOutput?.providerStatus || 'success').trim(),
    providerMessage: '',
    creditsConsumed: getProviderCreditsConsumed(imageOutput),
    imagePlan: {
      requestMode: 'image_generation',
      taskType: String(parsed.taskType || (inputImageUrls.length > 0 ? 'edit_image' : 'new_image')),
      selectedImageModel,
      inputImageUrls: preferredInputImageUrls,
      imageReferences: usedImageReferences,
      inputImageResolution: inputImageDetails,
      size: normalizedAspectRatio,
      resolution: normalizedResolution,
      transparentBackground: Boolean(parsed.transparentBackground && imageCapability.supportsTransparentBackground),
      prompt: finalPrompt,
      reasoningSummary: String(parsed.reasoningSummary || ''),
    },
    imageResultUrls: persistedImageUrl ? [persistedImageUrl] : [],
  };
  if (typeof onImageReady === 'function' && result.imageResultUrls.length > 0) {
    await onImageReady(result);
  }
  return result;
};

const findLocalUserById = (userId) => {
  const store = readLocalStore();
  return store.users.find((item) => item.id === userId) || null;
};

const getLocalJobByIdForUser = (user, jobId) => {
  const store = readLocalStore();
  const job = getLocalJobById(store, jobId);
  if (!job) return null;
  if (user.role !== 'admin' && job.userId !== user.id) return null;
  return job;
};

const listLocalVisibleAgentUsageRows = (store, admin) => {
  const manageableAgentIds = new Set(listLocalAgents(store, admin).map((item) => item.id));
  return (store.agentUsageLogs || [])
    .filter((item) => isSuperAdminUser(admin) || manageableAgentIds.has(item.agentId))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
};

const requireDbUser = async (req, res) => {
  let user = null;
  try {
    user = await getDbSessionUser(req);
  } catch (error) {
    if (isTransientMysqlConnectionError(error)) {
      json(res, 503, { message: '数据库连接暂时不可用，请稍后重试。' });
      return null;
    }
    throw error;
  }
  if (!user) {
    json(res, 401, { message: '登录状态已失效，请重新登录。' });
    return null;
  }
  return user;
};

const requireDbAdmin = async (req, res) => {
  const user = await requireDbUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: '只有管理员可以执行这个操作。' });
    return null;
  }
  return user;
};

// ── Studio Helper Functions ──

const STUDIO_CONFIG_ASSISTANT_PROMPT = ({ agentName, systemPrompt, knowledgeNames, manageableKnowledgeBases, manageableKnowledgeDocuments }) => `R Role 角色
你是智能体训练工作台助手。用户正在训练名为"${agentName}"的智能体草稿版本。

T Task 任务
1. 先理解用户要优化什么。
2. 给出明确建议。
3. 如存在可执行改动，在回复末尾输出结构化“待确认改动”。

C Constraint 约束
1. 你不能直接执行修改，只能给出建议和待确认改动。
2. 建议阶段不要直接宣称“我已经修改完成”或“已经写入知识库”。你只能说“建议如下，可确认后应用”。
3. 如果只是答疑，不要输出 CONFIG_CHANGES。
4. 删除知识库文档时必须提供 documentId。
5. 修改知识库文档时优先提供 documentId；没有 documentId 不要伪造。
6. 新增知识库文档时必须提供 knowledgeBaseId、title、rawText。
7. 不要输出不可执行的空字段。
8. 如果附件里有可用资料，可以据此整理出建议写入知识库的 rawText，但仍然只是建议，等待确认后才会真正应用。

F Format 格式
1. 先用自然语言说明你理解到的问题、建议怎么改。
2. 如果存在可执行改动，在末尾输出：
<CONFIG_CHANGES>[JSON数组]</CONFIG_CHANGES>

支持的 field：
- systemPrompt：更新系统提示词
- openingRemarks：更新开场白
- knowledgeBaseIds：调整当前智能体绑定的知识库
- modelPolicy：调整默认模型、简单问题模型、高级模型、多模态模型或生图开关
- retrievalPolicy：调整检索开关、参考数量、片段上限、上下文上限等策略
- knowledgeDocument：新增、修改或删除知识库文档

E Example 示例
JSON 数组中每项格式示例：
[
  {
    "field": "systemPrompt",
    "action": "update",
    "label": "更新系统提示词",
    "after": "完整的新提示词"
  },
  {
    "field": "openingRemarks",
    "action": "update",
    "label": "更新开场白",
    "after": "你好，我是你的课程顾问助理。"
  },
  {
    "field": "knowledgeBaseIds",
    "action": "update",
    "label": "绑定课程知识库",
    "knowledgeBaseIds": ["kb_xxx"]
  },
  {
    "field": "modelPolicy",
    "action": "update",
    "label": "调整模型策略",
    "modelPolicy": {
      "defaultModel": "gpt-5-4-openai-resp",
      "cheapModel": "gemini-3-flash-openai",
      "advancedModel": "gemini-3.1-pro-openai",
      "multimodalModel": "gpt-image-2",
      "imageGenerationEnabled": false,
      "allowedChatModels": ["gpt-5-4-openai-resp", "gemini-3-flash-openai"],
      "defaultChatModel": "gpt-5-4-openai-resp"
    }
  },
  {
    "field": "retrievalPolicy",
    "action": "update",
    "label": "调整检索策略",
    "retrievalPolicy": {
      "enabled": true,
      "topK": 3,
      "maxChunks": 5,
      "maxContextChars": 2400
    }
  },
  {
    "field": "knowledgeDocument",
    "action": "add",
    "label": "新增课程介绍文档",
    "knowledgeDocument": {
      "knowledgeBaseId": "kb_xxx",
      "title": "课程介绍",
      "rawText": "整理后的完整文档正文",
      "sourceType": "manual",
      "chunkStrategy": "balanced",
      "normalizationEnabled": true
    }
  }
]

当前系统提示词：
---
${systemPrompt || '（空）'}
---

${knowledgeNames.length > 0 ? `当前已绑定知识库：${knowledgeNames.join('、')}` : '当前未绑定知识库。'}

你可操作的知识库：
${manageableKnowledgeBases.length > 0
    ? manageableKnowledgeBases.map((item) => `- ${item.name}（id=${item.id}）`).join('\n')
    : '- 暂无可管理知识库'}

你可引用的已有知识库文档：
${manageableKnowledgeDocuments.length > 0
    ? manageableKnowledgeDocuments.map((item) => `- ${item.title}（documentId=${item.id}，knowledgeBaseId=${item.knowledgeBaseId}）`).join('\n')
    : '- 暂无已有知识库文档'}

用户会用自然语言提出训练需求，可能包括：
- 调整系统提示词
- 调整模型策略
- 调整检索策略
- 调整绑定知识库
- 新增、修改、删除知识库文档`;

const normalizeStudioKnowledgeDocumentChange = (value = {}) => {
  if (!value || typeof value !== 'object') return null;
  return {
    knowledgeBaseId: typeof value.knowledgeBaseId === 'string' ? value.knowledgeBaseId.trim() : undefined,
    documentId: typeof value.documentId === 'string' ? value.documentId.trim() : undefined,
    title: typeof value.title === 'string' ? value.title.trim() : undefined,
    rawText: typeof value.rawText === 'string' ? value.rawText.trim() : undefined,
    sourceType: value.sourceType === undefined ? undefined : normalizeSourceType(value.sourceType),
    chunkStrategy: value.chunkStrategy === undefined ? undefined : normalizeKnowledgeChunkStrategyValue(value.chunkStrategy),
    normalizationEnabled: value.normalizationEnabled === undefined ? undefined : Boolean(value.normalizationEnabled),
  };
};

const normalizeStudioConfigDiff = (input) => {
  if (!input || typeof input !== 'object') return null;
  const field = ['systemPrompt', 'openingRemarks', 'knowledgeDocument', 'modelPolicy', 'retrievalPolicy', 'knowledgeBaseIds'].includes(String(input.field || '').trim())
    ? String(input.field).trim()
    : '';
  const action = ['update', 'add', 'remove'].includes(String(input.action || '').trim())
    ? String(input.action).trim()
    : 'update';
  if (!field) return null;

  const diff = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createEntityId(),
    field,
    action,
    label: String(input.label || '待确认改动').trim() || '待确认改动',
    before: typeof input.before === 'string' ? input.before.trim() : '',
    after: typeof input.after === 'string' ? input.after.trim() : '',
    documentId: typeof input.documentId === 'string' ? input.documentId.trim() : undefined,
    documentTitle: typeof input.documentTitle === 'string' ? input.documentTitle.trim() : undefined,
    knowledgeBaseId: typeof input.knowledgeBaseId === 'string' ? input.knowledgeBaseId.trim() : undefined,
    knowledgeBaseIds: Array.isArray(input.knowledgeBaseIds) ? cleanKnowledgeBaseIds(input.knowledgeBaseIds) : [],
    modelPolicy: input.modelPolicy && typeof input.modelPolicy === 'object' ? {
      defaultModel: typeof input.modelPolicy.defaultModel === 'string' ? input.modelPolicy.defaultModel.trim() : undefined,
      cheapModel: typeof input.modelPolicy.cheapModel === 'string' ? input.modelPolicy.cheapModel.trim() : undefined,
      advancedModel: typeof input.modelPolicy.advancedModel === 'string' ? input.modelPolicy.advancedModel.trim() : undefined,
      multimodalModel: typeof input.modelPolicy.multimodalModel === 'string' ? input.modelPolicy.multimodalModel.trim() : undefined,
      imageGenerationEnabled: input.modelPolicy.imageGenerationEnabled === undefined ? undefined : Boolean(input.modelPolicy.imageGenerationEnabled),
      allowedChatModels: Array.isArray(input.modelPolicy.allowedChatModels)
        ? sanitizeAllowedChatModels(input.modelPolicy.allowedChatModels)
        : undefined,
      defaultChatModel: typeof input.modelPolicy.defaultChatModel === 'string' ? input.modelPolicy.defaultChatModel.trim() : undefined,
    } : undefined,
    retrievalPolicy: input.retrievalPolicy && typeof input.retrievalPolicy === 'object' ? {
      enabled: input.retrievalPolicy.enabled === undefined ? undefined : Boolean(input.retrievalPolicy.enabled),
      topK: input.retrievalPolicy.topK === undefined ? undefined : Number(input.retrievalPolicy.topK),
      maxChunks: input.retrievalPolicy.maxChunks === undefined ? undefined : Number(input.retrievalPolicy.maxChunks),
      similarityThreshold: input.retrievalPolicy.similarityThreshold === undefined ? undefined : Number(input.retrievalPolicy.similarityThreshold),
      maxContextChars: input.retrievalPolicy.maxContextChars === undefined ? undefined : Number(input.retrievalPolicy.maxContextChars),
    } : undefined,
    knowledgeDocument: normalizeStudioKnowledgeDocumentChange(input.knowledgeDocument),
    status: 'pending',
  };

  if (field === 'systemPrompt' && !diff.after) return null;
  if (field === 'openingRemarks' && !Object.prototype.hasOwnProperty.call(input, 'after')) return null;
  if (field === 'knowledgeBaseIds' && diff.knowledgeBaseIds.length === 0) return null;
  if (field === 'modelPolicy' && !diff.modelPolicy) return null;
  if (field === 'retrievalPolicy' && !diff.retrievalPolicy) return null;
  if (field === 'knowledgeDocument') {
    if (!diff.knowledgeDocument) return null;
    if (action === 'remove' && !(diff.knowledgeDocument.documentId || diff.documentId)) return null;
    if (action === 'add' && (!diff.knowledgeDocument.knowledgeBaseId || !diff.knowledgeDocument.title || !diff.knowledgeDocument.rawText)) return null;
  }
  return diff;
};

const parseConfigChanges = (text) => {
  const match = text.match(/<CONFIG_CHANGES>([\s\S]*?)<\/CONFIG_CHANGES>/);
  if (!match) return { cleanText: text, diffs: [] };
  try {
    const diffs = JSON.parse(match[1].trim());
    const cleanText = text.replace(/<CONFIG_CHANGES>[\s\S]*?<\/CONFIG_CHANGES>/, '').trim();
    return { cleanText, diffs: Array.isArray(diffs) ? diffs.map((item) => normalizeStudioConfigDiff(item)).filter(Boolean) : [] };
  } catch {
    return { cleanText: text, diffs: [] };
  }
};

const buildStudioKnowledgeMaps = (knowledgeBases = [], knowledgeDocuments = []) => ({
  knowledgeBaseMap: new Map((knowledgeBases || []).map((item) => [item.id, item])),
  knowledgeDocumentMap: new Map((knowledgeDocuments || []).map((item) => [item.id, item])),
});

const buildStudioDbKnowledgeContext = async (user) => {
  const manageableKnowledgeBases = await listDbKnowledgeBases(user);
  const manageableKnowledgeDocuments = [];
  for (const kb of manageableKnowledgeBases) {
    const docs = await listDbKnowledgeDocuments(user, kb.id);
    docs.forEach((doc) => manageableKnowledgeDocuments.push({
      id: doc.id,
      title: doc.title,
      knowledgeBaseId: doc.knowledgeBaseId,
    }));
  }
  return { manageableKnowledgeBases, manageableKnowledgeDocuments };
};

const buildStudioLocalKnowledgeContext = (store, user) => {
  const manageableKnowledgeBases = listLocalKnowledgeBases(store, user);
  const manageableKnowledgeDocuments = manageableKnowledgeBases.flatMap((kb) =>
    listLocalKnowledgeDocuments(store, user, kb.id).map((doc) => ({
      id: doc.id,
      title: doc.title,
      knowledgeBaseId: doc.knowledgeBaseId,
    }))
  );
  return { manageableKnowledgeBases, manageableKnowledgeDocuments };
};

const resolveStudioKnowledgeBaseTargetId = (change, updatedVersion, manageableKnowledgeBaseMap) => {
  const explicitId = String(
    change?.knowledgeBaseId ||
    change?.knowledgeDocument?.knowledgeBaseId ||
    ''
  ).trim();
  if (explicitId && manageableKnowledgeBaseMap.has(explicitId)) return explicitId;
  const boundIds = cleanKnowledgeBaseIds(updatedVersion?.knowledgeBaseIds);
  if (boundIds.length === 1 && manageableKnowledgeBaseMap.has(boundIds[0])) return boundIds[0];
  return '';
};

const applyStudioVersionChangePayload = (updatedVersion, change) => {
  if (change.field === 'systemPrompt') {
    return { systemPrompt: change.after };
  }
  if (change.field === 'openingRemarks') {
    return { openingRemarks: change.after || null };
  }
  if (change.field === 'knowledgeBaseIds') {
    return { knowledgeBaseIds: change.knowledgeBaseIds };
  }
  if (change.field === 'modelPolicy') {
    const nextModelPolicy = {
      ...(updatedVersion?.modelPolicy || {}),
      ...(change.modelPolicy || {}),
    };
    const nextAllowedChatModels = Array.isArray(change?.modelPolicy?.allowedChatModels) && change.modelPolicy.allowedChatModels.length > 0
      ? change.modelPolicy.allowedChatModels
      : updatedVersion.allowedChatModels;
    return {
      modelPolicy: nextModelPolicy,
      allowedChatModels: nextAllowedChatModels,
      defaultChatModel: change?.modelPolicy?.defaultChatModel || updatedVersion.defaultChatModel,
    };
  }
  if (change.field === 'retrievalPolicy') {
    return {
      retrievalPolicy: {
        ...(updatedVersion?.retrievalPolicy || {}),
        ...(change.retrievalPolicy || {}),
      },
    };
  }
  return null;
};

const applyStudioTrainingChanges = async (user, versionId, payload) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version || version.isPublished) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const { manageableKnowledgeBases, manageableKnowledgeDocuments } = await buildStudioDbKnowledgeContext(user);
  const { knowledgeBaseMap, knowledgeDocumentMap } = buildStudioKnowledgeMaps(manageableKnowledgeBases, manageableKnowledgeDocuments);
  const requestedChanges = Array.isArray(payload?.changes) ? payload.changes.map((item) => normalizeStudioConfigDiff(item)).filter(Boolean) : [];
  let updatedVersion = version;
  const appliedChanges = [];
  for (const change of requestedChanges) {
    const versionPayload = applyStudioVersionChangePayload(updatedVersion, change);
    if (versionPayload) {
      updatedVersion = await updateDbAgentVersion(user, versionId, versionPayload) || updatedVersion;
      appliedChanges.push({ ...change, status: 'applied' });
      continue;
    }
    if (change.field === 'knowledgeDocument' && change.knowledgeDocument) {
      const targetKnowledgeBaseId = resolveStudioKnowledgeBaseTargetId(change, updatedVersion, knowledgeBaseMap);
      if (change.action === 'add') {
        const created = await createDbKnowledgeDocument(user, {
          knowledgeBaseId: targetKnowledgeBaseId,
          title: change.knowledgeDocument.title,
          rawText: change.knowledgeDocument.rawText,
          sourceType: change.knowledgeDocument.sourceType || 'manual',
          chunkStrategy: change.knowledgeDocument.chunkStrategy || 'balanced',
          normalizationEnabled: change.knowledgeDocument.normalizationEnabled !== false,
        });
        if (created) {
          appliedChanges.push({
            ...change,
            documentId: created.id,
            documentTitle: created.title,
            knowledgeBaseId: created.knowledgeBaseId,
            status: 'applied',
          });
          updatedVersion = await updateDbAgentVersion(user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
        }
      } else if (change.action === 'update') {
        const targetDocumentId = change.knowledgeDocument.documentId || change.documentId;
        if (targetDocumentId && knowledgeDocumentMap.has(targetDocumentId)) {
          const updatedDocument = await updateDbKnowledgeDocument(user, targetDocumentId, {
            title: change.knowledgeDocument.title,
            rawText: change.knowledgeDocument.rawText,
            sourceType: change.knowledgeDocument.sourceType,
            chunkStrategy: change.knowledgeDocument.chunkStrategy,
            normalizationEnabled: change.knowledgeDocument.normalizationEnabled,
          });
          if (updatedDocument) {
            appliedChanges.push({
              ...change,
              documentId: updatedDocument.id,
              documentTitle: updatedDocument.title,
              knowledgeBaseId: updatedDocument.knowledgeBaseId,
              status: 'applied',
            });
            updatedVersion = await updateDbAgentVersion(user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
          }
        }
      } else if (change.action === 'remove') {
        const targetDocumentId = change.knowledgeDocument.documentId || change.documentId;
        if (targetDocumentId && knowledgeDocumentMap.has(targetDocumentId)) {
          const deletedCount = await deleteDbKnowledgeDocument(user, targetDocumentId);
          if (deletedCount > 0) {
            appliedChanges.push({ ...change, documentId: targetDocumentId, status: 'applied' });
            updatedVersion = await updateDbAgentVersion(user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
          }
        }
      }
    }
  }
  return { appliedChanges, updatedVersion };
};

const applyLocalStudioTrainingChanges = async (store, user, versionId, payload) => {
  const version = getLocalAgentVersionById(store, versionId);
  if (!version || version.isPublished) return null;
  const agent = getLocalAgentById(store, version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const { manageableKnowledgeBases, manageableKnowledgeDocuments } = buildStudioLocalKnowledgeContext(store, user);
  const { knowledgeBaseMap, knowledgeDocumentMap } = buildStudioKnowledgeMaps(manageableKnowledgeBases, manageableKnowledgeDocuments);
  const requestedChanges = Array.isArray(payload?.changes) ? payload.changes.map((item) => normalizeStudioConfigDiff(item)).filter(Boolean) : [];
  let updatedVersion = version;
  const appliedChanges = [];
  for (const change of requestedChanges) {
    const versionPayload = applyStudioVersionChangePayload(updatedVersion, change);
    if (versionPayload) {
      updatedVersion = updateLocalAgentVersion(store, user, versionId, versionPayload) || updatedVersion;
      appliedChanges.push({ ...change, status: 'applied' });
      continue;
    }
    if (change.field === 'knowledgeDocument' && change.knowledgeDocument) {
      const targetKnowledgeBaseId = resolveStudioKnowledgeBaseTargetId(change, updatedVersion, knowledgeBaseMap);
      if (change.action === 'add') {
        const created = await createLocalKnowledgeDocument(store, user, {
          knowledgeBaseId: targetKnowledgeBaseId,
          title: change.knowledgeDocument.title,
          rawText: change.knowledgeDocument.rawText,
          sourceType: change.knowledgeDocument.sourceType || 'manual',
          chunkStrategy: change.knowledgeDocument.chunkStrategy || 'balanced',
          normalizationEnabled: change.knowledgeDocument.normalizationEnabled !== false,
        });
        if (created) {
          appliedChanges.push({
            ...change,
            documentId: created.id,
            documentTitle: created.title,
            knowledgeBaseId: created.knowledgeBaseId,
            status: 'applied',
          });
          updatedVersion = updateLocalAgentVersion(store, user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
        }
      } else if (change.action === 'update') {
        const targetDocumentId = change.knowledgeDocument.documentId || change.documentId;
        if (targetDocumentId && knowledgeDocumentMap.has(targetDocumentId)) {
          const updatedDocument = await updateLocalKnowledgeDocument(store, user, targetDocumentId, {
            title: change.knowledgeDocument.title,
            rawText: change.knowledgeDocument.rawText,
            sourceType: change.knowledgeDocument.sourceType,
            chunkStrategy: change.knowledgeDocument.chunkStrategy,
            normalizationEnabled: change.knowledgeDocument.normalizationEnabled,
          });
          if (updatedDocument) {
            appliedChanges.push({
              ...change,
              documentId: updatedDocument.id,
              documentTitle: updatedDocument.title,
              knowledgeBaseId: updatedDocument.knowledgeBaseId,
              status: 'applied',
            });
            updatedVersion = updateLocalAgentVersion(store, user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
          }
        }
      } else if (change.action === 'remove') {
        const targetDocumentId = change.knowledgeDocument.documentId || change.documentId;
        if (targetDocumentId && knowledgeDocumentMap.has(targetDocumentId)) {
          const deletedCount = deleteLocalKnowledgeDocument(store, user, targetDocumentId);
          if (deletedCount > 0) {
            appliedChanges.push({ ...change, documentId: targetDocumentId, status: 'applied' });
            updatedVersion = updateLocalAgentVersion(store, user, versionId, { knowledgeBaseIds: updatedVersion.knowledgeBaseIds }) || updatedVersion;
          }
        }
      }
    }
  }
  return { appliedChanges, updatedVersion };
};

const handleStudioTrainingMessage = async (user, versionId, payload) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version || version.isPublished) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const content = String(payload?.content || '').trim();
  if (!content) throw new Error('消息内容不能为空。');
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  await assertOwnedActiveManagedAssetReferences({
    value: attachments,
    userId: user.id,
    pool: await getMysqlPool(),
  });
  const publicBaseUrl = getPersistentAssetBaseUrl();
  const selectedModel = resolveChatSessionModel(version, payload?.selectedModel || version.defaultChatModel || version.modelPolicy?.defaultModel || '');
  const capability = getChatModelCapability(selectedModel, publicBaseUrl);
  const capabilityError = getAttachmentCapabilityError({ capability, attachments, requestMode: 'chat', modelLabel: `模型 ${selectedModel} ` });
  if (capabilityError) throw new Error(capabilityError);
  if (payload?.webSearchEnabled && !capability?.supportsWebSearch) {
    throw new Error('当前模型不支持联网');
  }
  const kbIds = Array.isArray(version.knowledgeBaseIds) ? version.knowledgeBaseIds : [];
  const knowledgeNames = [];
  for (const kbId of kbIds) {
    const kb = await getDbKnowledgeBaseById(kbId);
    if (kb) knowledgeNames.push(kb.name);
  }
  const { manageableKnowledgeBases, manageableKnowledgeDocuments } = await buildStudioDbKnowledgeContext(user);
  const systemPrompt = STUDIO_CONFIG_ASSISTANT_PROMPT({
    agentName: agent.name,
    systemPrompt: version.systemPrompt,
    knowledgeNames,
    manageableKnowledgeBases,
    manageableKnowledgeDocuments,
  });
  const priorMessages = history.map((m) => ({
    id: '',
    sessionId: '',
    userId: '',
    role: m.role,
    content: m.content,
    attachments: Array.isArray(m?.attachments) ? m.attachments.map((item) => ({
      name: String(item?.name || '').trim() || '附件',
      url: item?.url ? String(item.url) : undefined,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      kind: item?.kind === 'image' ? 'image' : 'file',
    })) : [],
    createdAt: 0,
  }));
  const result = await runAgentConversation({
    user, agent, version: { ...version, systemPrompt },
    priorMessages,
    currentMessage: content,
    attachments,
    selectedModelOverride: selectedModel,
    reasoningLevel: payload?.reasoningLevel || null,
    webSearchEnabled: Boolean(payload?.webSearchEnabled),
  });
  const rawReply = String(result?.content || '').trim();
  const { cleanText, diffs } = parseConfigChanges(rawReply);
  return { reply: cleanText, configDiffs: diffs, updatedVersion: version };
};

const createStudioTestSession = async (user, payload) => {
  const agentId = String(payload?.agentId || '').trim();
  const versionId = String(payload?.versionId || '').trim();
  if (!agentId || !versionId) return null;
  const agent = await getDbAgentById(agentId);
  if (!agent) return null;
  const version = await getDbAgentVersionById(versionId);
  if (!version || version.agentId !== agentId || version.isPublished) return null;
  if (!canManageOwnedResource(user, agent.ownerUserId)) return null;
  const selectedModel = resolveChatSessionModel(version);
  const capability = getChatModelCapability(selectedModel, getPersistentAssetBaseUrl());
  const defaultReasoningLevel = resolveSessionReasoningLevel({ capability, requestedReasoningLevel: null });
  const pool = await getMysqlPool();
  const sessionId = createEntityId();
  const now = Date.now();
  await pool.query(
    `INSERT INTO chat_sessions (id, user_id, agent_id, agent_version_id, title, status, summary, selected_model, reasoning_level, web_search_enabled, last_image_mode, is_studio, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, agentId, versionId, '工作室测试', 'active', null, selectedModel || '', defaultReasoningLevel, 0, 0, 1, now, now]
  );
  return {
    id: sessionId, userId: user.id, agentId, agentVersionId: versionId,
    title: '工作室测试', status: 'active', summary: '',
    selectedModel: selectedModel || '', reasoningLevel: defaultReasoningLevel,
    webSearchEnabled: false, lastImageMode: false, createdAt: now, updatedAt: now,
  };
};

const getOwnedVirtualModelSourceAsset = async ({ pool, user, assetId }) => {
  const source = await getStoredAssetById(pool, assetId);
  if (
    !source
    || source.deletedAt
    || source.module !== 'virtual_model'
    || source.userId !== user.id
  ) {
    throw Object.assign(
      new Error('Virtual model source asset is unavailable'),
      { code: 'MODEL_ASSET_UNAVAILABLE' },
    );
  }
  if (!String(source.mimeType || '').toLowerCase().startsWith('image/')) {
    throw Object.assign(
      new Error('Virtual model source asset must be an image'),
      { code: 'MODEL_ASSET_INVALID' },
    );
  }
  return source;
};

const createVirtualModelPreviewAsset = async ({ req, user, pool, source }) => {
  const publicBaseUrl = getPersistentAssetBaseUrl(req);
  if (!isExternallyReachableBaseUrl(publicBaseUrl) && (shouldUseMysql || !publicBaseUrl)) {
    throw Object.assign(
      new Error('Virtual model preview storage is unavailable'),
      { code: 'MODEL_PREVIEW_UNAVAILABLE' },
    );
  }
  const sourcePath = resolveStoredAssetPath(source);
  let sourceBuffer;
  if (sourcePath && existsSync(sourcePath)) {
    sourceBuffer = readFileSync(sourcePath);
  } else {
    const sourceReadUrl = await resolveManagedAssetReadUrl(source.publicUrl, {
      pool,
      userId: user.id,
      purpose: 'provider',
      env: process.env,
    });
    sourceBuffer = (await fetchRemoteAssetBufferWithRetry(sourceReadUrl)).fileBuffer;
  }
  const sharp = (await import('sharp')).default;
  const rendered = await sharp(sourceBuffer)
    .rotate()
    .resize(480, 640, { fit: 'cover', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return persistAssetBuffer({
    pool,
    publicBaseUrl,
    userId: user.id,
    module: 'virtual_model',
    assetType: 'preview',
    originalName: `preview_${source.id}.jpg`,
    mimeType: 'image/jpeg',
    fileBuffer: rendered.data,
    width: rendered.info.width || 0,
    height: rendered.info.height || 0,
    provider: 'internal',
  });
};

const isOwnedVirtualModelPreviewAsset = async ({
  pool,
  user,
  previewAssetId,
  previewUrl,
}) => {
  const preview = await getStoredAssetById(pool, previewAssetId);
  return Boolean(
    preview
    && !preview.deletedAt
    && preview.module === 'virtual_model'
    && preview.assetType === 'preview'
    && preview.userId === user.id
    && preview.publicUrl === previewUrl
  );
};

const handleVirtualModelApiRequest = async ({
  req,
  res,
  url,
  user,
  pool = null,
  store = null,
  persist = () => {},
}) => {
  const validateSelectionMatch = url.pathname === '/api/virtual-models/validate-selection';
  const publicDetailMatch = url.pathname.match(/^\/api\/virtual-models\/([^/]+)$/);
  const adminDetailMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)$/);
  const adminDeleteMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)$/);
  const adminVersionMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)\/versions$/);
  const adminAssetsMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)\/versions\/([^/]+)\/assets$/);
  const adminPublishMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)\/publish$/);
  const adminUnpublishMatch = url.pathname.match(/^\/api\/admin\/virtual-models\/([^/]+)\/unpublish$/);
  const isAdminList = url.pathname === '/api/admin/virtual-models' && req.method === 'GET';
  const isCreate = url.pathname === '/api/admin/virtual-models' && req.method === 'POST';
  const isAdminWrite = isCreate
    || (adminDetailMatch && req.method === 'PATCH')
    || (adminDeleteMatch && req.method === 'DELETE')
    || (adminVersionMatch && req.method === 'POST')
    || (adminAssetsMatch && req.method === 'PUT')
    || (adminPublishMatch && req.method === 'POST')
    || (adminUnpublishMatch && req.method === 'POST');

  if (!(
    url.pathname === '/api/virtual-models'
    || validateSelectionMatch
    || publicDetailMatch
    || isAdminList
    || isAdminWrite
  )) return false;
  const dataSource = { pool, store };

  try {
    if (url.pathname === '/api/virtual-models' && req.method === 'GET') {
      const models = await listPublishedVirtualModels(dataSource);
      json(res, 200, { models: models.map(toVirtualModelPublicSummary) });
      return true;
    }
    if (validateSelectionMatch && req.method === 'POST') {
      try {
        const body = await readBody(req);
        await createVirtualModelGenerationJobSnapshot({
          ...dataSource,
          virtualModelId: String(body?.virtualModelId || '').trim(),
          virtualModelVersionId: String(body?.virtualModelVersionId || '').trim(),
        });
        json(res, 200, { ok: true });
      } catch {
        json(res, 200, { ok: false });
      }
      return true;
    }
    if (publicDetailMatch && req.method === 'GET') {
      const model = await getPublishedVirtualModelDetail({
        ...dataSource,
        virtualModelId: decodeURIComponent(publicDetailMatch[1]),
      });
      if (!model) {
        json(res, 404, {
          code: 'MODEL_NOT_FOUND',
          message: 'Virtual model not found.',
        });
      } else {
        json(res, 200, { model: toVirtualModelPublicSummary(model) });
      }
      return true;
    }
    if (isAdminList) {
      if (user.role !== 'admin') {
        json(res, 403, {
          code: 'MODEL_PERMISSION_DENIED',
          message: 'Admin only.',
        });
        return true;
      }
      const models = await listAdminVirtualModels({
        ...dataSource,
        status: url.searchParams.get('status') || 'all',
      });
      json(res, 200, { models });
      return true;
    }
    if (isAdminWrite && user.role !== 'admin') {
      json(res, 403, {
        code: 'MODEL_PERMISSION_DENIED',
        message: '仅管理员可管理虚拟模特库。',
      });
      return true;
    }
    if (isCreate) {
      const body = await readBody(req);
      const model = await createVirtualModelDraft({
        ...dataSource,
        code: body?.code,
        name: body?.name,
        tags: body?.tags,
      });
      persist();
      json(res, 201, { model });
      return true;
    }
    if (adminDetailMatch && req.method === 'PATCH') {
      const body = await readBody(req);
      const model = await updateVirtualModelDraft({
        ...dataSource,
        virtualModelId: decodeURIComponent(adminDetailMatch[1]),
        code: body?.code,
        name: body?.name,
        tags: body?.tags,
      });
      persist();
      json(res, 200, { model });
      return true;
    }
    if (adminDeleteMatch && req.method === 'DELETE') {
      return await handleVirtualModelDeleteApiRequest({
        req,
        res,
        url,
        user,
        ...dataSource,
        persist,
      });
    }
    if (adminVersionMatch && req.method === 'POST') {
      const body = await readBody(req);
      const version = await createVirtualModelVersion({
        ...dataSource,
        virtualModelId: decodeURIComponent(adminVersionMatch[1]),
        identityProfile: body?.identityProfile,
        createdBy: user.id,
      });
      persist();
      json(res, 201, { version });
      return true;
    }
    if (adminAssetsMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const assetsWithPreviews = await Promise.all(
        (Array.isArray(body?.assets) ? body.assets : []).map(async (asset) => {
          const source = await getOwnedVirtualModelSourceAsset({
            pool,
            user,
            assetId: String(asset?.assetId || '').trim(),
          });
          if (
            asset?.previewAssetId
            && asset?.previewUrl
            && asset.previewAssetId !== asset.assetId
            && asset.previewUrl !== asset.publicUrl
            && await isOwnedVirtualModelPreviewAsset({
              pool,
              user,
              previewAssetId: asset.previewAssetId,
              previewUrl: asset.previewUrl,
            })
          ) {
            return { ...asset, publicUrl: source.publicUrl };
          }
          const preview = await createVirtualModelPreviewAsset({
            req,
            user,
            pool,
            source,
          });
          return {
            ...asset,
            publicUrl: source.publicUrl,
            previewAssetId: preview.id,
            previewUrl: preview.publicUrl,
          };
        }),
      );
      const assets = await replaceDraftVersionAssets({
        ...dataSource,
        virtualModelId: decodeURIComponent(adminAssetsMatch[1]),
        virtualModelVersionId: decodeURIComponent(adminAssetsMatch[2]),
        assets: assetsWithPreviews,
      });
      persist();
      json(res, 200, { assets });
      return true;
    }
    if (adminPublishMatch && req.method === 'POST') {
      const body = await readBody(req);
      const result = await publishVirtualModelVersion({
        ...dataSource,
        virtualModelId: decodeURIComponent(adminPublishMatch[1]),
        virtualModelVersionId: String(body?.virtualModelVersionId || '').trim(),
      });
      persist();
      json(
        res,
        result.ok ? 200 : 400,
        result.ok ? { result } : { code: 'MODEL_PUBLISH_INVALID', ...result },
      );
      return true;
    }
    if (adminUnpublishMatch && req.method === 'POST') {
      const result = await unpublishVirtualModel({
        ...dataSource,
        virtualModelId: decodeURIComponent(adminUnpublishMatch[1]),
      });
      persist();
      json(res, 200, { result });
      return true;
    }
  } catch (error) {
    respondVirtualModelApiError(res, error);
    return true;
  }
  return false;
};

const handleMysqlRequest = async (req, res, url) => {
  const userDetailMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  const agentDetailMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  const agentDraftMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/draft$/);
  const agentPublishMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/publish$/);
  const agentRollbackMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/rollback$/);
  const agentVersionsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/versions$/);
  const agentVersionDetailMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)$/);
  const agentVersionValidateMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)\/validate$/);
  const knowledgeBaseDetailMatch = url.pathname.match(/^\/api\/knowledge-bases\/([^/]+)$/);
  const knowledgeDocumentsMatch = url.pathname.match(/^\/api\/knowledge-documents$/);
  const knowledgeDocumentDetailMatch = url.pathname.match(/^\/api\/knowledge-documents\/([^/]+)$/);
  const chatAgentHistoryMatch = url.pathname.match(/^\/api\/chat\/agents\/([^/]+)\/history$/);
  const chatSessionDetailMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  const chatSessionMessagesMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  const studioTrainingMatch = url.pathname.match(/^\/api\/studio\/training\/([^/]+)\/message$/);
  const studioTrainingApplyMatch = url.pathname.match(/^\/api\/studio\/training\/([^/]+)\/apply$/);
  const taskPlatformTimelineMatch = url.pathname.match(/^\/api\/admin\/task-platform\/jobs\/([^/]+)\/timeline$/);
  const taskPlatformSubmissionResolutionMatch = url.pathname.match(/^\/api\/admin\/task-platform\/jobs\/([^/]+)\/submission-resolution$/);

  if (isMediaTranscodeRoute(url, req.method)) {
    const user = await requireDbUser(req, res);
    if (!user) return;
    await handleMediaTranscodeRequest({ req, res, url, user });
    return;
  }

  const assetRouteMatch = url.pathname.match(ASSET_FILE_ROUTE_REGEX);
  if ((req.method === 'GET' || req.method === 'HEAD') && assetRouteMatch) {
    const assetId = decodeURIComponent(assetRouteMatch[1]);
    await serveStoredAsset(req, res, assetId, {
      accessKey: getManagedAssetAccessKeyFromUrl(url),
      resolveRequestUserId: async () => String((await getDbSessionUser(req))?.id || ''),
    });
    return;
  }

  if (
    url.pathname.startsWith('/api/virtual-models')
    || url.pathname.startsWith('/api/admin/virtual-models')
  ) {
    const user = await requireDbUser(req, res);
    if (!user) return;
    if (await handleVirtualModelApiRequest({
      req,
      res,
      url,
      user,
      pool: await getMysqlPool(),
    })) return;
  }

  if (url.pathname === '/api/assets/download-proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
    const user = await requireDbUser(req, res);
    if (!user) return;
    await proxyRemoteDownload(req, res, url.searchParams.get('url') || '');
    return;
  }

  if (url.pathname === '/api/video-diagnosis/probe' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    await handleVideoDiagnosisProbeRequest(req, res);
    return;
  }

  if (url.pathname === '/api/video-diagnosis/analyze' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    await handleVideoDiagnosisAnalyzeRequest(req, res);
    return;
  }

  if (url.pathname === '/api/chatwoot/ai-webhook' && req.method === 'POST') {
    const systemSettings = await getDbSystemSettings();
    await handleChatwootAiWebhookRequest(req, res, url, systemSettings);
    return;
  }

  if (url.pathname === '/api/chatwoot/test-connection' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await testChatwootConnection(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 连接测试失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversations' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootConversations(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/messages' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootConversationMessages(body || {}, body?.conversationId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/send-message' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await sendChatwootConversationMessage(body || {}, body?.conversationId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 回复发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/send-attachment' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const formData = await readMultipartFormData(req);
      const result = await sendChatwootConversationAttachment({
        baseUrl: formData.get('baseUrl'),
        accountId: formData.get('accountId'),
        inboxId: formData.get('inboxId'),
        apiToken: formData.get('apiToken'),
      }, formData.get('conversationId'), {
        content: formData.get('content'),
        file: formData.get('file'),
        fileName: formData.get('fileName'),
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 附件发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversation-status' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootConversationStatus(body || {}, body?.conversationId, body?.status);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话状态更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/internal-note' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootInternalNote(body || {}, body?.conversationId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 内部备注发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/labels' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootLabels(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 标签拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversation-labels' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootConversationLabels(body || {}, body?.conversationId, body?.labels);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话标签更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/assignable-agents' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootAssignableAgents(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 坐席拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/teams' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootTeams(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 团队拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/assign-conversation' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await assignChatwootConversation(body || {}, body?.conversationId, {
        assigneeId: body?.assigneeId,
        teamId: body?.teamId,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话分配失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/canned-responses' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootCannedResponses(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 话术拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/canned-response' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootCannedResponse(body || {}, {
        shortCode: body?.shortCode,
        content: body?.content,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 话术创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/automation-rules' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootAutomationRules(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 自动化规则拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contacts' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContacts(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户资料拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-notes' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContactNotes(body || {}, body?.contactId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户备注拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-note' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootContactNote(body || {}, body?.contactId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户备注创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-contact' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootContact(body || {}, body?.contactId, {
        name: body?.name,
        email: body?.email,
        phone: body?.phone,
        customAttributes: body?.customAttributes,
        additionalAttributes: body?.additionalAttributes,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户资料更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-conversations' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContactConversations(body || {}, body?.contactId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户历史会话拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/delete-message' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await deleteChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息删除失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/retry-message' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await retryChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息重试失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/translate-message' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await translateChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId, body?.targetLanguage || 'zh_CN');
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息翻译失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/macros' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootMacros(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/macro' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootMacro(body || {}, {
        name: body?.name,
        visibility: body?.visibility,
        actions: body?.actions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/execute-macro' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await executeChatwootMacro(body || {}, body?.macroId, body?.conversationIds);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏执行失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/campaigns' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootCampaigns(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 活动拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/campaign' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootCampaign(body || {}, {
        title: body?.title,
        message: body?.message,
        inboxId: body?.inboxId,
        enabled: body?.enabled,
        triggerOnlyDuringBusinessHours: body?.triggerOnlyDuringBusinessHours,
        audience: body?.audience,
        triggerRules: body?.triggerRules,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 活动创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/webhooks' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootWebhooks(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/webhook' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootWebhook(body || {}, {
        name: body?.name,
        url: body?.url,
        subscriptions: body?.subscriptions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-webhook' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootWebhook(body || {}, body?.webhookId, {
        name: body?.name,
        url: body?.url,
        subscriptions: body?.subscriptions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/inboxes' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootInboxes(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 收件箱拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-inbox' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootInbox(body || {}, body?.targetInboxId || body?.inboxId, {
        name: body?.name,
        enableAutoAssignment: body?.enableAutoAssignment,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 收件箱更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/reports-summary' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootReportsSummary(body || {}, {
        since: body?.since,
        until: body?.until,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 报表摘要拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = await findDbUserByUsername(username);

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      await createDbLog({
        user: buildLogActor({ username: username || 'unknown', displayName: username || 'unknown' }),
        level: 'error',
        module: 'account',
        action: 'login_failed',
        message: `登录失败：${username || '未知用户'}`,
        detail: '用户名或密码不正确。',
        status: 'failed',
        meta: { username: username || 'unknown' },
      });
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    const loginTime = Date.now();
    await updateDbUserLoginTime(user.id, loginTime);
    await ensureDbAppState(user.id);
    const token = await createDbSession(user.id);
    const freshUser = await findDbUserById(user.id);
    await createDbLog({
      user: freshUser || user,
      level: 'info',
      module: 'account',
      action: 'login_success',
      message: '登录成功',
      status: 'success',
      meta: { role: user.role },
    });
    json(res, 200, { token, user: cleanUser(freshUser || user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const updatedUser = await withManagedAssetUserLock(user.id, async (pool) => {
      await assertOwnedActiveManagedAssetReferences({
        value: body?.avatarUrl,
        userId: user.id,
        pool,
      });
      return updateDbUser(user.id, {
        displayName: typeof body?.displayName === 'string' ? String(body.displayName) : undefined,
        avatarUrl: body?.avatarUrl === null ? null : typeof body?.avatarUrl === 'string' ? String(body.avatarUrl) : undefined,
        avatarPreset: body?.avatarPreset === null ? null : typeof body?.avatarPreset === 'string' ? String(body.avatarPreset) : undefined,
        analysisModel: body?.analysisModel === undefined ? undefined : normalizeUserAnalysisModel(body.analysisModel),
        usernameFallback: user.displayName || user.username,
      });
    });
    json(res, 200, { user: cleanUser(updatedUser || user) });
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = await getDbSessionUser(req);
    const token = getTokenFromRequest(req);
    if (token) {
      await deleteDbSession(token);
    }
    if (user) {
      await createDbLog({
        user,
        level: 'info',
        module: 'account',
        action: 'logout',
        message: '退出登录',
        status: 'success',
      });
    }
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/smart-factory/preview-turn' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const systemSettings = await getDbSystemSettings();
    const result = await runSmartFactoryPreviewTurn({
      message: body.message,
      agentId: body.agentId,
      smartFactoryConfig: composeSmartFactoryConfigForRuntime(systemSettings),
    });
    json(res, 200, { result });
    return;
  }

  if (url.pathname === '/api/smart-factory/config' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const systemSettings = await getDbSystemSettings();
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(systemSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/config' && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = mergeSmartFactoryConfigUpdate(currentSettings.smartFactory, body?.smartFactory ?? body?.config ?? body);
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      smartFactory: nextSmartFactory,
    });
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-providers' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      modelProviders: upsertModelProvider(currentSettings.modelProviders, body),
    });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-provider-presets' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { presets: getModelProviderPresets() });
    return;
  }

  const dbSmartFactoryModelProviderMatch = url.pathname.match(/^\/api\/smart-factory\/model-providers\/([^/]+)$/);
  if (dbSmartFactoryModelProviderMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      modelProviders: deleteModelProvider(currentSettings.modelProviders, decodeURIComponent(dbSmartFactoryModelProviderMatch[1])),
    });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-providers/test' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    json(res, 200, await testSmartFactoryModelProviderConnection(body, { env: process.env }));
    return;
  }

  if (url.pathname === '/api/smart-factory/agents' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = createSmartFactoryAgent(currentSettings.smartFactory, body);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const dbSmartFactoryAgentMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/([^/]+)$/);
  if (dbSmartFactoryAgentMatch && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = updateSmartFactoryAgent(currentSettings.smartFactory, decodeURIComponent(dbSmartFactoryAgentMatch[1]), body);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (dbSmartFactoryAgentMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const currentSettings = await getDbSystemSettings();
    const factoryAgentId = decodeURIComponent(dbSmartFactoryAgentMatch[1]);
    let nextSmartFactory;
    try {
      nextSmartFactory = deleteSmartFactoryAgent(currentSettings.smartFactory, factoryAgentId);
    } catch (error) {
      json(res, 400, { message: error?.message || '删除智能体失败。' });
      return;
    }
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    let agentCenterUnlink = null;
    try {
      agentCenterUnlink = await unpublishLinkedAgentCenterAgentDb(factoryAgentId);
    } catch (error) {
      agentCenterUnlink = { error: String(error?.message || error) };
    }
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }), agentCenterUnlink });
    return;
  }

  const dbSmartFactoryAgentPublishMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/([^/]+)\/publish$/);
  if (dbSmartFactoryAgentPublishMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const factoryAgentId = decodeURIComponent(dbSmartFactoryAgentPublishMatch[1]);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = publishSmartFactoryAgent(currentSettings.smartFactory, factoryAgentId);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    let agentCenterSync = null;
    try {
      agentCenterSync = await syncFactoryAgentToDbAgentCenter(user, composeSmartFactoryConfigForRuntime(nextSettings), factoryAgentId);
    } catch (error) {
      agentCenterSync = { synced: false, syncError: String(error?.message || error) };
    }
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }),
      agentCenterSync,
    });
    return;
  }

  // 接管中心存量智能体(与本地段 localSmartFactoryAdoptMatch 同构,根因#7)
  const dbSmartFactoryAdoptMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/adopt\/([^/]+)$/);
  if (dbSmartFactoryAdoptMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const centerAgentId = decodeURIComponent(dbSmartFactoryAdoptMatch[1]);
    const result = await adoptCenterAgentIntoDbFactory(user, centerAgentId);
    if (result.status !== 200) {
      json(res, result.status, result.body);
      return;
    }
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(result.nextSettings) }),
      ...result.body,
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-bases' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = createSmartFactoryKnowledgeBase(currentSettings.smartFactory, body);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const dbSmartFactoryKnowledgeBaseMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-bases\/([^/]+)$/);
  if (dbSmartFactoryKnowledgeBaseMatch && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = updateSmartFactoryKnowledgeBase(currentSettings.smartFactory, decodeURIComponent(dbSmartFactoryKnowledgeBaseMatch[1]), body);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (dbSmartFactoryKnowledgeBaseMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = deleteSmartFactoryKnowledgeBase(currentSettings.smartFactory, decodeURIComponent(dbSmartFactoryKnowledgeBaseMatch[1]));
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/chat' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const result = await runSmartFactoryPreviewTurn({
      message: body.message,
      agentId: body.agentId,
      smartFactoryConfig: composeSmartFactoryConfigForRuntime(currentSettings),
    });
    const nextAgentState = appendSmartFactoryConversationTurn(currentSettings.smartFactory, {
      sessionId: body.sessionId,
      userMessage: body.message,
      assistantAnswer: result.answer,
      trace: result.trace,
    });
    const nextSmartFactory = mergeSmartFactoryConfigUpdate(currentSettings.smartFactory, {
      agents: nextAgentState.agents,
      sessions: nextAgentState.sessions,
    });
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      smartFactory: nextSmartFactory,
    });
    json(res, 200, {
      result,
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-documents' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const addedSmartFactory = addSmartFactoryKnowledgeDocument(currentSettings.smartFactory, {
      knowledgeBaseId: body.knowledgeBaseId,
      document: body.document,
    });
    const trainingResult = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(addedSmartFactory, body.knowledgeBaseId, {
      env: process.env,
    });
    const nextSmartFactory = trainingResult.config;
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      smartFactory: nextSmartFactory,
    });
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  const dbSmartFactoryRetrainDocumentMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-documents\/([^/]+)\/retrain$/);
  if (dbSmartFactoryRetrainDocumentMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const documentId = decodeURIComponent(dbSmartFactoryRetrainDocumentMatch[1]);
    const retrainedSmartFactory = retrainSmartFactoryKnowledgeDocument(currentSettings.smartFactory, documentId, body);
    const trainingResult = await maybeTrainSmartFactoryKnowledgeDocumentEmbeddings(retrainedSmartFactory, documentId, {
      env: process.env,
    });
    const nextSmartFactory = trainingResult.config;
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const dbSmartFactoryDeleteDocumentMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-documents\/([^/]+)$/);
  if (dbSmartFactoryDeleteDocumentMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = deleteSmartFactoryKnowledgeDocument(currentSettings.smartFactory, decodeURIComponent(dbSmartFactoryDeleteDocumentMatch[1]));
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-search' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    json(res, 200, {
      search: testSmartFactoryKnowledgeSearch({
        query: body.query,
        knowledgeBaseIds: body.knowledgeBaseIds,
        retrievalPolicy: body.retrievalPolicy,
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(currentSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/tools' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = upsertSmartFactoryTool(currentSettings.smartFactory, body);
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const dbSmartFactoryToolMatch = url.pathname.match(/^\/api\/smart-factory\/tools\/([^/]+)$/);
  if (dbSmartFactoryToolMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const currentSettings = await getDbSystemSettings();
    const nextSmartFactory = deleteSmartFactoryTool(currentSettings.smartFactory, decodeURIComponent(dbSmartFactoryToolMatch[1]));
    const nextSettings = await saveDbSystemSettings({ ...currentSettings, smartFactory: nextSmartFactory });
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const dbSmartFactoryToolTestMatch = url.pathname.match(/^\/api\/smart-factory\/tools\/([^/]+)\/test$/);
  if (dbSmartFactoryToolTestMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const toolName = decodeURIComponent(dbSmartFactoryToolTestMatch[1]);
    const currentSettings = await getDbSystemSettings();
    const tool = normalizeSmartFactoryConfig(currentSettings.smartFactory).tools.find((item) => item.name === toolName);
    if (!tool) {
      json(res, 404, { error: '工具不存在。' });
      return;
    }
    const messages = tool.type === 'builtin'
      ? await runBuiltinMediaTool({
          executorRef: tool.executorRef,
          args: body || {},
          tool,
          env: process.env,
        })
      : await runAllowedCliTool({
          executorRef: tool.executorRef,
          args: body || {},
          env: process.env,
        });
    json(res, 200, {
      ok: true,
      toolName,
      observation: formatSmartFactoryToolMessagesForTest(messages),
    });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const users = await listDbUsers();
    json(res, 200, { users: users.map(cleanUser) });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'staff';
    const jobConcurrency = normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const featurePermissions = normalizeFeaturePermissions(body.featurePermissions);
    const creditLimitMode = normalizeCreditLimitMode(body.creditLimitMode);
    const creditBalance = normalizeCreditBalanceInput(body.creditBalance);

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    const existingUser = await findDbUserByUsername(username);
    if (existingUser) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = await createDbUser({ username, password, role, displayName, jobConcurrency, featurePermissions, creditLimitMode, creditBalance });
    await createDbLog({
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_created',
      message: `创建账号：${newUser.username}`,
      status: 'success',
      meta: {
        targetUserId: newUser.id,
        targetUsername: newUser.username,
        targetDisplayName: newUser.displayName,
        targetRole: newUser.role,
        targetJobConcurrency: newUser.jobConcurrency,
        targetFeaturePermissions: newUser.featurePermissions,
        targetCreditLimitMode: newUser.creditLimitMode,
        targetCreditBalance: newUser.creditBalance,
      },
    });
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { agents: await listDbAgents(admin) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const createdAgent = await createDbAgent(admin, body || {});
    json(res, 201, createdAgent);
    return;
  }

  if (agentDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const agent = await getDbAgentById(decodeURIComponent(agentDetailMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在。' });
      return;
    }
    json(res, 200, { agent, versions: await listDbAgentVersionsByAgentId(agent.id) });
    return;
  }

  if (agentDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agentId = decodeURIComponent(agentDetailMatch[1]);
    const agentForLock = await getDbAgentById(agentId);
    if (!agentForLock || !canManageOwnedResource(admin, agentForLock.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    if (!isStatusOnlyAgentPatch(body)) {
      if (rejectIfFactoryManaged(res, agentForLock)) return;
    }
    const agent = await withManagedAssetUserLock(agentForLock.ownerUserId, async (pool) => {
      await assertOwnedActiveManagedAssetReferences({
        value: body?.iconUrl,
        userId: agentForLock.ownerUserId,
        pool,
      });
      return updateDbAgent(admin, agentId, body || {});
    });
    if (!agent) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await deleteDbAgent(admin, decodeURIComponent(agentDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { ...result, message: '智能体已永久删除。' });
    return;
  }

  if (agentDraftMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const agentId = decodeURIComponent(agentDraftMatch[1]);
    const agentForLock = await getDbAgentById(agentId);
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const version = await createDbAgentDraft(admin, agentId);
    if (!version) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 201, { version });
    return;
  }

  if (agentPublishMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agent = await publishDbAgentVersion(admin, decodeURIComponent(agentPublishMatch[1]), body?.versionId ? String(body.versionId) : null);
    if (!agent) {
      json(res, 400, { message: '发布失败，请先完成成功验证。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentRollbackMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agent = await rollbackDbAgentVersion(admin, decodeURIComponent(agentRollbackMatch[1]), String(body?.versionId || ''));
    if (!agent) {
      json(res, 400, { message: '回滚失败。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentVersionsMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const agent = await getDbAgentById(decodeURIComponent(agentVersionsMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { versions: await listDbAgentVersionsByAgentId(agent.id) });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const version = await getDbAgentVersionById(decodeURIComponent(agentVersionDetailMatch[1]));
    const agent = version ? await getDbAgentById(version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const versionId = decodeURIComponent(agentVersionDetailMatch[1]);
    const versionForLock = await getDbAgentVersionById(versionId);
    const agentForLock = versionForLock ? await getDbAgentById(versionForLock.agentId) : null;
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const version = await updateDbAgentVersion(admin, versionId, body || {});
    if (!version) {
      json(res, 400, { message: '版本不存在、已发布或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const versionId = decodeURIComponent(agentVersionDetailMatch[1]);
    const versionForLock = await getDbAgentVersionById(versionId);
    const agentForLock = versionForLock ? await getDbAgentById(versionForLock.agentId) : null;
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const result = await deleteDbAgentVersion(admin, versionId);
    if (!result) {
      json(res, 400, { message: '版本不存在、已发布或无权限，不能永久删除。' });
      return;
    }
    json(res, 200, { ...result, message: '版本已永久删除。' });
    return;
  }

  if (agentVersionValidateMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const versionId = decodeURIComponent(agentVersionValidateMatch[1]);
    try {
      const result = await validateDbAgentVersion(admin, versionId, body?.message);
      if (!result) {
        json(res, 404, { message: '版本不存在或无权限。' });
        return;
      }
      const agent = await getDbAgentById(result.version.agentId);
      await createDbAgentUsageLog(admin, agent, result.version, result.result, 'success');
      json(res, 200, result);
    } catch (error) {
      const version = await getDbAgentVersionById(versionId);
      const agent = version ? await getDbAgentById(version.agentId) : null;
      if (version && agent) {
        await createDbLog({
          user: admin,
          level: 'error',
          module: 'agent_center',
          action: 'agent_validate',
          message: `智能体验证失败：${agent.name}`,
          detail: error?.message || '智能体验证失败。',
          status: 'failed',
          meta: buildAgentRuntimeLogMeta({
            agent,
            version,
            requestMode: 'validation',
            error,
          }),
        }).catch(() => null);
      }
      json(res, 500, { message: error?.message || '智能体验证失败。' });
    }
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { knowledgeBases: await listDbKnowledgeBases(admin) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    json(res, 201, { knowledgeBase: await createDbKnowledgeBase(admin, body || {}) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBase = await getDbKnowledgeBaseById(decodeURIComponent(knowledgeBaseDetailMatch[1]));
    if (!knowledgeBase || !canManageOwnedResource(admin, knowledgeBase.ownerUserId)) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase, documents: await listDbKnowledgeDocuments(admin, knowledgeBase.id) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = await updateDbKnowledgeBase(admin, decodeURIComponent(knowledgeBaseDetailMatch[1]), body || {});
    if (!knowledgeBase) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseDetailMatch[1]);
    const deletedCount = await deleteDbKnowledgeBase(admin, knowledgeBaseId);
    if (!deletedCount) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { ok: true, deletedKnowledgeBaseId: knowledgeBaseId, message: '知识库已永久删除。' });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBaseId = String(url.searchParams.get('knowledgeBaseId') || '');
    json(res, 200, { documents: await listDbKnowledgeDocuments(admin, knowledgeBaseId) });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const document = await createDbKnowledgeDocument(admin, body || {});
    if (!document) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 201, { document });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const deletedCount = await deleteDbKnowledgeDocument(admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]));
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const document = await updateDbKnowledgeDocument(admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]), body || {});
    if (!document) {
      json(res, 404, { message: '文档不存在或无权限。' });
      return;
    }
    json(res, 200, { document });
    return;
  }

  if (url.pathname === '/api/chat/agents' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { agents: await listDbChatAgents() });
    return;
  }

  if (chatAgentHistoryMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const result = await deleteDbUserAgentHistory(user, decodeURIComponent(chatAgentHistoryMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { sessions: await listDbChatSessions(user, String(url.searchParams.get('agentId') || '')) });
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const agentId = String(body?.agentId || '');
    const session = await createDbChatSession(user, agentId);
    if (!session) {
      json(res, 404, { message: '智能体不存在或尚未发布。' });
      return;
    }
    const versionForRemarks = session.agentVersionId ? await getDbAgentVersionById(session.agentVersionId).catch(() => null) : null;
    json(res, 201, { session, openingRemarks: versionForRemarks?.openingRemarks || null });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const session = await createDbChatSessionOptions(user, decodeURIComponent(chatSessionDetailMatch[1]), body || {});
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    json(res, 200, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const result = await deleteDbChatSession(user, decodeURIComponent(chatSessionDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { messages: await listDbChatMessages(user, decodeURIComponent(chatSessionMessagesMatch[1])) });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
    const wantsStream = String(req.headers.accept || '').includes('text/event-stream') || body?.stream === true;
    let chatStreamHadDelta = false;
    const sendChatEvent = wantsStream
      ? (type, payload = {}) => {
          if (res.writableEnded) return;
          const normalizedType = type === 'progress' && payload?.stage ? String(payload.stage) : type;
          if (normalizedType === 'streaming' && payload?.delta) chatStreamHadDelta = true;
          res.write(formatChatSseEvent(normalizedType, payload));
        }
      : null;
    try {
      if (wantsStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...(res.__corsHeaders || {}),
        });
        const stopChatHeartbeat = startChatSseHeartbeat(res);
        res.once('close', stopChatHeartbeat);
        sendChatEvent('thinking', {});
      }
      const result = await createDbChatReply(user, sessionId, body || {}, sendChatEvent);
      if (!result) {
        if (wantsStream) {
          sendChatEvent('error', { message: '会话不存在或无权限。' });
          res.end();
          return;
        }
        json(res, 404, { message: '会话不存在或无权限。' });
        return;
      }
      if (wantsStream) {
        if (!chatStreamHadDelta) sendChatEvent('streaming', { delta: result.assistantMessage?.content || '' });
        sendChatEvent('done', { assistantMessage: result.assistantMessage, usage: result.usage });
        res.end();
        return;
      }
      json(res, 201, result);
    } catch (error) {
      const session = await getDbChatSessionById(user, sessionId);
      const version = session ? await getDbAgentVersionById(session.agentVersionId) : null;
      const agent = session ? await getDbAgentById(session.agentId) : null;
      if (session && version && agent && error?.code !== 'agent_chat_run_active') {
        await createDbLog({
          user,
          level: 'error',
          module: 'agent_center',
          action: body?.requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
          message: `${body?.requestMode === 'image_generation' ? '智能体生图失败' : '智能体对话失败'}：${agent.name}`,
          detail: error?.message || '聊天回复失败。',
          status: 'failed',
          meta: buildAgentRuntimeLogMeta({
            agent,
            version,
            requestMode: body?.requestMode === 'image_generation' ? 'image_generation' : 'chat',
            sessionId,
            clientRequestId: String(body?.clientRequestId || '').trim(),
            error,
          }),
        }).catch(() => null);
      }
      if (wantsStream) {
        sendChatEvent('error', { message: error?.message || '聊天回复失败。', code: error?.code || '' });
        res.end();
        return;
      }
      json(res, error?.statusCode || 500, { message: error?.message || '聊天回复失败。', code: error?.code || '' });
    }
    return;
  }

  // ── Studio: Training Channel ──
  if (studioTrainingMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const versionId = decodeURIComponent(studioTrainingMatch[1]);
    const body = await readBody(req);
    try {
      const result = await handleStudioTrainingMessage(admin, versionId, body || {});
      if (!result) {
        json(res, 404, { message: '版本不存在、非草稿或无权限。' });
        return;
      }
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { message: error?.message || '训练消息处理失败。' });
    }
    return;
  }

  if (studioTrainingApplyMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const versionId = decodeURIComponent(studioTrainingApplyMatch[1]);
    const body = await readBody(req);
    try {
      const result = await applyStudioTrainingChanges(admin, versionId, body || {});
      if (!result) {
        json(res, 404, { message: '版本不存在、非草稿或无权限。' });
        return;
      }
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { message: error?.message || '训练改动应用失败。' });
    }
    return;
  }

  // ── Studio: Create Test Session ──
  if (url.pathname === '/api/studio/test/sessions' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    try {
      const session = await createStudioTestSession(admin, body || {});
      if (!session) {
        json(res, 404, { message: '智能体或版本不存在，或非草稿版本。' });
        return;
      }
      json(res, 201, { session });
    } catch (error) {
      json(res, 500, { message: error?.message || '创建测试会话失败。' });
    }
    return;
  }

  if (url.pathname === '/api/agent-usage' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { rows: await listDbAgentUsage(admin) });
    return;
  }

  if (url.pathname === '/api/agent-usage/summary' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { summary: await getDbAgentUsageSummary(admin) });
    return;
  }

  if (url.pathname === '/api/admin/task-platform/health' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const health = await getTaskPlatformHealth({ engine: process.env.MEIAO_TASK_ENGINE, temporalAdapter: temporalTaskAdapter });
    json(res, 200, health);
    return;
  }

  if (url.pathname === '/api/admin/task-platform/jobs' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const pool = await getMysqlPool();
    const result = await listTaskPlatformJobs(pool, {
      status: url.searchParams.get('status'),
      module: url.searchParams.get('module'),
      provider: url.searchParams.get('provider'),
      taskType: url.searchParams.get('taskType'),
      userId: url.searchParams.get('userId'),
      traceId: url.searchParams.get('traceId'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    });
    json(res, 200, result);
    return;
  }

  if (taskPlatformSubmissionResolutionMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const pool = await getMysqlPool();
    const jobId = decodeURIComponent(taskPlatformSubmissionResolutionMatch[1]);
    let resolution;
    try {
      resolution = await resolveSubmissionUnknownJob({
        pool,
        jobId,
        action: body?.action,
        providerTaskId: body?.providerTaskId,
        actualCreditsConsumed: body?.actualCreditsConsumed,
        verificationNote: body?.verificationNote,
        releaseReservation: async (connection, job) => {
          const reservation = getCreditReservationFromJob(job);
          if (!reservation) return null;
          return releaseDbAccountCredits(connection, reservation, {
            module: job.module,
            taskType: job.taskType,
            provider: job.provider,
            reason: 'admin_submission_resolution',
            meta: { adminUserId: admin.id, jobId: job.id },
          });
        },
        settleReservation: async (connection, job, settlementInput) => {
          const reservation = getCreditReservationFromJob(job);
          if (!reservation) return { settledAmount: 0, noReservation: true };
          return settleDbAccountCredits(connection, reservation, {
            result: { creditsConsumed: settlementInput.actualCreditsConsumed },
            module: job.module,
            taskType: job.taskType,
            provider: job.provider,
            reason: 'admin_submission_settlement',
            meta: {
              adminUserId: admin.id,
              jobId: job.id,
              verificationNote: settlementInput.verificationNote,
            },
          });
        },
      });
    } catch (error) {
      if (error?.statusCode) {
        json(res, error.statusCode, { message: error.message, code: error.code });
        return;
      }
      throw error;
    }

    await createDbLog({
      user: admin,
      level: 'info',
      module: resolution.job.module,
      action: 'submission_unknown_resolved',
      message: `管理员人工处置提交状态未知任务：${resolution.job.id}`,
      status: 'success',
      meta: {
        jobId: resolution.job.id,
        action: resolution.action,
        providerTaskId: resolution.job.providerTaskId || '',
        targetUserId: resolution.job.userId,
        ...(resolution.action === 'settle' ? {
          actualCreditsConsumed: Number(body?.actualCreditsConsumed),
          verificationNote: String(body?.verificationNote || '').trim().slice(0, 500),
        } : {}),
      },
    });
    await recordDbTaskPlatformEvent(pool, resolution.job, {
      stage: resolution.action === 'bind'
        ? 'provider_wait'
        : resolution.action === 'settle'
          ? 'completed'
          : 'failed',
      eventName: `submission_unknown_${resolution.action}`,
      status: resolution.action === 'bind' ? 'started' : 'success',
      providerSubmitted: Boolean(resolution.job.providerTaskId),
      providerTaskId: resolution.job.providerTaskId || '',
      errorCode: resolution.job.errorCode,
      errorMessage: resolution.job.errorMessage,
      meta: {
        adminUserId: admin.id,
        resolutionAction: resolution.action,
        ...(resolution.action === 'settle' ? {
          actualCreditsConsumed: Number(body?.actualCreditsConsumed),
          verificationNote: String(body?.verificationNote || '').trim().slice(0, 500),
        } : {}),
      },
    });
    if (resolution.action === 'bind') {
      await mirrorDbJobToTemporalIfEnabled(pool, resolution.job);
      if (normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE) !== 'temporal') {
        jobWorker?.trigger?.();
      }
    }
    json(res, 200, resolution);
    return;
  }

  if (taskPlatformTimelineMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const pool = await getMysqlPool();
    const jobId = decodeURIComponent(taskPlatformTimelineMatch[1]);
    const job = await getJobById(pool, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    const timeline = await getTaskPlatformTimeline(pool, job.id);
    json(res, 200, { job, timeline });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await listDbLogs({
      module: url.searchParams.get('module'),
      userId: url.searchParams.get('userId'),
      status: url.searchParams.get('status'),
      startAt: url.searchParams.get('startAt'),
      endAt: url.searchParams.get('endAt'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    });
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/logs/meta' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const meta = await listDbLogMeta();
    json(res, 200, meta);
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 403, { message: '运行日志仅按 7 天保留策略自动清理，禁止手动清理。' });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const log = await createDbLog({
      user,
      level: body.level === 'error' ? 'error' : 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: String(body.action || 'unknown').slice(0, 100),
      message: String(body.message || '未提供日志描述').slice(0, 1000),
      detail: typeof body.detail === 'string' ? body.detail.slice(0, 10000) : '',
      status: ['success', 'failed', 'started', 'interrupted'].includes(body.status) ? body.status : 'started',
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
    });
    json(res, 201, { ok: true, log });
    return;
  }

  if (url.pathname === '/api/stats/usage' && req.method === 'GET') {
    const viewer = await requireDbUser(req, res);
    if (!viewer) return;
    const pool = await getMysqlPool();
    const clauses = [];
    const values = [];
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const requestedUserId = normalizeLogFilterValue(url.searchParams.get('userId'));
    const userId = viewer.role === 'admin' ? requestedUserId : viewer.id;
    const mod = normalizeLogFilterValue(url.searchParams.get('module'));
    if (startDate) { clauses.push('stat_date >= ?'); values.push(startDate); }
    if (endDate) { clauses.push('stat_date <= ?'); values.push(endDate); }
    if (userId) { clauses.push('user_id = ?'); values.push(userId); }
    if (mod) { clauses.push('module = ?'); values.push(mod); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT stat_date, user_id, username, display_name, module,
       success_count, failed_count, interrupted_count, credits_consumed
       FROM usage_daily ${where} ORDER BY stat_date ASC`, values
    );
    let resultRows = rows.map((r) => ({
      statDate: typeof r.stat_date === 'string' ? r.stat_date : new Date(r.stat_date).toISOString().split('T')[0],
      userId: r.user_id, username: r.username, displayName: r.display_name, module: r.module,
      successCount: Number(r.success_count), failedCount: Number(r.failed_count),
      interruptedCount: Number(r.interrupted_count),
      creditsConsumed: Number(r.credits_consumed || 0),
    }));
    if (!mod || mod === 'agent_center') {
      const usageClauses = [];
      const usageValues = [];
      if (viewer.role !== 'admin') {
        usageClauses.push('l.user_id = ?');
        usageValues.push(viewer.id);
      } else if (!isSuperAdminUser(viewer)) {
        usageClauses.push('a.owner_user_id = ?');
        usageValues.push(viewer.id);
      }
      if (startDate) { usageClauses.push('DATE(FROM_UNIXTIME(l.created_at / 1000)) >= ?'); usageValues.push(startDate); }
      if (endDate) { usageClauses.push('DATE(FROM_UNIXTIME(l.created_at / 1000)) <= ?'); usageValues.push(endDate); }
      if (userId && viewer.role === 'admin') { usageClauses.push('l.user_id = ?'); usageValues.push(userId); }
      const usageWhere = usageClauses.length > 0 ? `WHERE ${usageClauses.join(' AND ')}` : '';
      const [agentUsageRows] = await pool.query(
        `SELECT l.user_id, l.username, l.display_name, l.status, l.created_at
         FROM agent_usage_logs l
         LEFT JOIN agents a ON a.id = l.agent_id
         ${usageWhere}`,
        usageValues
      );
      resultRows = [...resultRows, ...aggregateAgentUsageStatsRows(agentUsageRows)];
    }
    json(res, 200, { rows: resultRows.sort((a, b) => a.statDate.localeCompare(b.statDate)) });
    return;
  }

  if (url.pathname === '/api/stats/backfill' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const pool = await getMysqlPool();
    const [logRows] = await pool.query(
      `SELECT DATE(FROM_UNIXTIME(created_at / 1000)) AS d,
       user_id, username, display_name, module, status, COUNT(*) AS cnt,
       SUM(CASE WHEN status = 'success' THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.creditsConsumed')) AS DECIMAL(12,2)), 0) ELSE 0 END) AS credits
       FROM internal_logs
       WHERE module IN ('agent_center','one_click','translation','buyer_show','retouch','video','xhs_cover')
       AND status IN ('success','failed','interrupted')
       AND (
         action IN ('agent_chat','agent_validate','analysis_token_usage','generate_main_scheme','generate_detail_scheme','generate_single','generate_board','regenerate_board','create_image_task')
         OR (
           action = 'job_completed'
           AND JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.taskType')) IN ('dreamina_video','kie_seedance_video','kie_video','kie_veo','maxforai_video')
         )
       )
       GROUP BY d, user_id, username, display_name, module, status`
    );
    const toStatDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
    const recomputeDates = Array.from(new Set(logRows.map((row) => toStatDate(row.d)).filter(Boolean)));
    if (recomputeDates.length > 0) {
      const datePlaceholders = recomputeDates.map(() => '?').join(', ');
      await pool.query(
        `DELETE FROM usage_daily
         WHERE stat_date IN (${datePlaceholders})
         AND module IN ('agent_center','one_click','translation','buyer_show','retouch','video','xhs_cover')`,
        recomputeDates
      );
    }
    let upserted = 0;
    for (const row of logRows) {
      const statDate = toStatDate(row.d);
      if (!statDate) continue;
      const field = row.status === 'success' ? 'success_count'
        : row.status === 'failed' ? 'failed_count' : 'interrupted_count';
      await pool.query(
        `INSERT INTO usage_daily (stat_date, user_id, username, display_name, module, ${field}, credits_consumed)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ${field} = ${field} + VALUES(${field}), credits_consumed = credits_consumed + VALUES(credits_consumed)`,
        [statDate, row.user_id, row.username, row.display_name, row.module, Number(row.cnt), Number(row.credits || 0)]
      );
      upserted++;
    }
    json(res, 200, { ok: true, upserted });
    return;
  }

  if (userDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = await findAnyDbUserById(targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    const body = await readBody(req);
    const nextStatus = body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : undefined;
    const nextRole = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : undefined;
    const nextPassword = typeof body.password === 'string' ? String(body.password) : '';
    const nextDisplayName = typeof body.displayName === 'string' ? String(body.displayName) : undefined;
    const nextJobConcurrency = body.jobConcurrency === undefined ? undefined : normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const nextFeaturePermissions = body.featurePermissions === undefined ? undefined : normalizeFeaturePermissions(body.featurePermissions);
    const nextAnalysisModel = body.analysisModel === undefined ? undefined : normalizeUserAnalysisModel(body.analysisModel);
    const nextCreditLimitMode = body.creditLimitMode === undefined ? undefined : normalizeCreditLimitMode(body.creditLimitMode);
    const nextCreditBalance = body.creditBalance === undefined ? undefined : normalizeCreditBalanceInput(body.creditBalance);
    let previousStatus = targetUser.status;

    if (targetUser.id === admin.id && nextStatus === 'disabled') {
      json(res, 400, { message: '不能禁用当前登录管理员。' });
      return;
    }

    if (targetUser.role === 'admin' && (nextRole === 'staff' || nextStatus === 'disabled')) {
      const adminCount = await countDbAdmins();
      if (adminCount <= 1) {
        json(res, 400, { message: '至少要保留一个可用管理员账号。' });
        return;
      }
    }

    const updatedUser = await withManagedAssetUserLock(targetUser.id, async (lockedPool) => {
      const lockedTargetUser = await findAnyDbUserById(targetUser.id, lockedPool);
      if (!lockedTargetUser) return null;
      previousStatus = lockedTargetUser.status;
      return updateDbUser(targetUser.id, {
        displayName: nextDisplayName,
        role: nextRole,
        status: nextStatus,
        jobConcurrency: nextJobConcurrency,
        featurePermissions: nextFeaturePermissions,
        analysisModel: nextAnalysisModel,
        creditLimitMode: nextCreditLimitMode,
        creditBalance: nextCreditBalance,
        password: nextPassword,
        usernameFallback: lockedTargetUser.displayName || lockedTargetUser.username,
      }, lockedPool);
    });
    if (!updatedUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    if (nextStatus === 'disabled' || nextPassword) {
      const pool = await getMysqlPool();
      await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetUser.id]);
    }

    if (nextPassword) {
      await createDbLog({
        user: admin,
        level: 'info',
        module: 'account',
        action: 'password_reset',
        message: `重置密码：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    if (nextStatus && nextStatus !== previousStatus) {
      await createDbLog({
        user: admin,
        level: 'info',
        module: 'account',
        action: nextStatus === 'disabled' ? 'user_disabled' : 'user_enabled',
        message: `${nextStatus === 'disabled' ? '禁用' : '启用'}账号：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    json(res, 200, { user: cleanUser(updatedUser) });
    return;
  }

  if (userDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = await findAnyDbUserById(targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    if (targetUser.id === admin.id) {
      json(res, 400, { message: '不能删除当前登录管理员。' });
      return;
    }

    if (targetUser.role === 'admin') {
      const adminCount = await countDbAdmins();
      if (adminCount <= 1) {
        json(res, 400, { message: '至少要保留一个可用管理员账号。' });
        return;
      }
    }

    await deleteDbUser(targetUser.id);
    await createDbLog({
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_deleted',
      message: `删除账号并清理账号数据：${targetUser.username}`,
      status: 'success',
      meta: {
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        usageStatsPreserved: true,
      },
    });
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const state = await scrubDbStateForUnavailableManagedAssets(await getDbAppState(user.id), user.id);
    json(res, 200, { state: prepareStateForClient(state) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req, { maxBytes: MAX_STATE_BODY_BYTES });
    const incomingState = body.state || createDefaultState();
    const response = await writeMergedAppStateUnderUserLock({
      user,
      incomingState,
      includeCanonicalState: Boolean(body.includeCanonicalState),
      withUserLock: withManagedAssetUserLock,
      readState: getDbAppStateUnderManagedAssetLock,
      scrubState: scrubDbStateBeforeStorage,
      saveState: saveDbAppStateAndQueueRemovedAssetsUnderLock,
      prepareCanonicalState: prepareStateForClient,
    });
    json(res, 200, response);
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const pool = await getMysqlPool();
    const queueStats = await getJobQueueStats(pool);
    const systemSettings = await getDbSystemSettings();
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, queueStats, {
        maxConcurrency: await getDbWorkerConcurrency(),
        systemSettings,
        userSettings: { analysisModel: user.analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      analysisModel: body?.analysisModel ?? currentSettings.analysisModel,
      videoAnalysisModel: body?.videoAnalysisModel ?? currentSettings.videoAnalysisModel,
      announcement: mergeSystemAnnouncementUpdate(currentSettings, body?.announcement, admin),
      openaiCompatible: mergeOpenAICompatibleSettingsUpdate(currentSettings, body?.openaiCompatible),
      modelProviders: body?.modelProviders === undefined
        ? currentSettings.modelProviders
        : mergeModelProviderRegistryUpdate(currentSettings.modelProviders, body.modelProviders),
    });
    const pool = await getMysqlPool();
    const queueStats = await getJobQueueStats(pool);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, queueStats, {
        maxConcurrency: await getDbWorkerConcurrency(),
        systemSettings: nextSettings,
        userSettings: { analysisModel: admin.analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const systemSettings = await getDbSystemSettings();
    json(res, 200, {
      registry: getPublicModelProviderRegistry(systemSettings.modelProviders),
      presets: getModelProviderPresets(),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      modelProviders: upsertModelProvider(currentSettings.modelProviders, body),
    });
    json(res, 200, {
      registry: getPublicModelProviderRegistry(nextSettings.modelProviders),
    });
    return;
  }

  const dbSystemModelProviderMatch = url.pathname.match(/^\/api\/system\/model-providers\/([^/]+)$/);
  if (dbSystemModelProviderMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      modelProviders: deleteModelProvider(currentSettings.modelProviders, decodeURIComponent(dbSystemModelProviderMatch[1])),
    });
    json(res, 200, {
      registry: getPublicModelProviderRegistry(nextSettings.modelProviders),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers/test' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    json(res, 200, await testSmartFactoryModelProviderConnection(body, { env: process.env }));
    return;
  }

  if (url.pathname === '/api/system/analysis-model/broadcast' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const currentSettings = await getDbSystemSettings();
    const analysisModel = await updateDbAllUsersAnalysisModel(currentSettings.analysisModel);
    const pool = await getMysqlPool();
    const queueStats = await getJobQueueStats(pool);
    json(res, 200, {
      ok: true,
      analysisModel,
      config: buildPublicSystemConfig(process.env, queueStats, {
        maxConcurrency: await getDbWorkerConcurrency(),
        systemSettings: currentSettings,
        userSettings: { analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/dreamina/status' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { status: await getDreaminaStatus(process.env) });
    return;
  }

  if (url.pathname === '/api/dreamina/login' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const login = await startDreaminaLogin(process.env);
    json(res, 200, { login });
    return;
  }

  if (url.pathname === '/api/dreamina/login/check' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const login = await checkDreaminaLogin({
      deviceCode: body?.deviceCode,
      poll: body?.poll,
      env: process.env,
    });
    const status = await getDreaminaStatus(process.env);
    json(res, 200, { login, status });
    return;
  }

  if (url.pathname === '/api/dreamina/logout' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await logoutDreamina(process.env);
    const status = await getDreaminaStatus(process.env);
    json(res, 200, { ok: true, result, status });
    return;
  }

  if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req, { maxBytes: getManagedImageJsonBodyMaxBytes() });
    const base64Data = String(body.base64Data || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const originalFileName = String(body.fileName || 'upload.bin').trim();
    const assetType = String(body.assetType || 'source').trim().toLowerCase();
    if (!base64Data) {
      json(res, 400, { message: '上传内容不能为空。' });
      return;
    }

    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName: String(body.module || 'system').slice(0, 60),
      assetType,
      fileName: originalFileName,
      mimeType,
      fileBuffer: Buffer.from(base64Data, 'base64'),
    });
    if (persisted) {
      await createDbLog({
        user,
        level: 'info',
        module: String(body.module || 'system').slice(0, 60),
        action: 'asset_persisted',
        message: `素材上传成功：${originalFileName}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: stripManagedAssetAccessKey(persisted.publicUrl),
        },
      });
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const pool = await getMysqlPool();
    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const uploadJob = await createJobRecord(pool, user, {
      module: String(body.module || 'system').slice(0, 60),
      taskType: 'upload_asset',
      provider: 'kie',
      payload: {
        base64Data,
        mimeType,
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizeUploadFileName(originalFileName)}`,
        uploadPath,
      },
      maxRetries: 1,
    });
    const result = await executeProviderJobWithManagedAssetScrub(uploadJob, process.env, new AbortController().signal);
    await createDbLog({
      user,
      level: 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: 'upload_asset',
      message: `素材上传成功：${originalFileName}`,
      status: 'success',
      meta: {
        jobId: uploadJob.id,
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    json(res, 200, {
      fileUrl: result?.result?.fileUrl || '',
    });
    return;
  }

  if (url.pathname === '/api/assets/upload-stream' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const formData = await readMultipartFormData(req, { inspectManagedImage: true });
    const file = formData.get('file');
    const moduleName = String(formData.get('module') || 'system').slice(0, 60);
    const assetType = String(formData.get('assetType') || 'source').trim().toLowerCase();
    if (!(file instanceof File)) {
      json(res, 400, { message: '上传文件不能为空。' });
      return;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName,
      assetType,
      fileName: file.name || 'upload.bin',
      mimeType: file.type || 'application/octet-stream',
      fileBuffer,
    });
    if (persisted) {
      await createDbLog({
        user,
        level: 'info',
        module: moduleName,
        action: 'asset_persisted',
        message: `素材上传成功：${file.name || 'upload.bin'}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: stripManagedAssetAccessKey(persisted.publicUrl),
        },
      });
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const result = await executeProviderJobWithManagedAssetScrub({
      taskType: 'upload_asset',
      payload: {
        fileBuffer,
        mimeType: file.type || 'application/octet-stream',
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizeUploadFileName(file.name || 'upload.bin')}`,
        uploadPath,
      },
    }, process.env, new AbortController().signal);
    await createDbLog({
      user,
      level: 'info',
      module: moduleName,
      action: 'upload_asset',
      message: `素材上传成功：${file.name || 'upload.bin'}`,
      status: 'success',
      meta: {
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    json(res, 200, { fileUrl: result?.result?.fileUrl || '' });
    return;
  }

  if (url.pathname === '/api/assets/by-url' && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    try {
      const result = await deleteStoredAssetForUser({ user, fileUrl: body?.fileUrl });
      await createDbLog({
        user,
        level: 'info',
        module: 'xhs_cover',
        action: 'delete_project',
        message: result.deleted ? '删除小红书封面素材成功' : '小红书封面素材已不存在',
        status: 'success',
        meta: {
          assetId: result.assetId,
          fileUrl: stripManagedAssetAccessKey(body?.fileUrl),
        },
      });
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { message: error instanceof Error ? error.message : '删除素材失败' });
    }
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    let body = await readBody(req);
    if (!body?.taskType || !body?.provider) {
      json(res, 400, { message: '任务类型和 provider 不能为空。' });
      return;
    }
    const pool = await getMysqlPool();
    let submissionPolicy;
    try {
      const prepared = await prepareVoiceoverSubmission({
        body,
        user,
        pool,
        signal: req.signal,
      });
      body = prepared.body;
      submissionPolicy = resolveAuthorizedJobSubmissionPolicy(user, body, {
        voiceoverSourceProbe: prepared.sourceProbe || {},
      });
    } catch (error) {
      respondJobSubmissionPolicyError(res, error);
      return;
    }

    const jobPayload = {
      module: body.module,
      taskType: submissionPolicy.taskType,
      provider: submissionPolicy.provider,
      payload: await scrubDbJobPayloadBeforeSubmission(
        await createLibraryModelJobPayload({ payload: body.payload, pool, user }),
        user.id,
      ),
      priority: body.priority,
      maxRetries: submissionPolicy.maxCreateRetries ?? normalizeJobMaxRetries(body.taskType, body.maxRetries),
    };
    const submission = await withManagedAssetUserLock(user.id, async (lockedPool) => {
      await assertActiveDbUserUnderManagedAssetLock(lockedPool, user.id, '账号已删除，未创建任务');
      await assertOwnedActiveManagedAssetReferences({
        value: jobPayload.payload,
        userId: user.id,
        pool: lockedPool,
      });
      const submissionOptions = {
        user,
        jobPayload,
        dedupeWindowMs: submissionPolicy.dedupeWindowMs,
        findReusableJob: findReusableJobRecord,
        reserveCredits: reserveDbJobCreditsForSubmission,
        createJob: createDbJobRecordWithReservation,
      };
      if (jobPayload.taskType === 'subtitle_remove_video') {
        return withMysqlSubmissionLock(
          lockedPool,
          buildSubtitleRemovalUserGuardSubmission(user.id),
          async (connection) => {
            const guardState = await getSubtitleRemovalSubmissionGuardState(connection, user.id, jobPayload.payload);
            assertSubtitleRemovalBatchSubmissionAllowed({
              userId: user.id,
              payload: jobPayload.payload,
              batchMaxItems: getSubtitleRemovalConfig(process.env).batchMaxItems,
              ...guardState,
            });
            return createSerializedJobSubmissionOnConnection({ connection, ...submissionOptions });
          },
          { timeoutSeconds: getJobSubmissionLockTimeoutSeconds(process.env) },
        );
      }
      return createSerializedJobSubmission({
        pool: lockedPool,
        lockTimeoutSeconds: getJobSubmissionLockTimeoutSeconds(process.env),
        ...submissionOptions,
      });
    });
    if (submission.deduped) {
      json(res, 200, submission);
      return;
    }
    const { job } = submission;
    await createDbLog({
      user,
      level: 'info',
      module: job.module,
      action: 'job_created',
      message: `创建任务：${job.taskType}`,
      status: 'started',
      meta: buildJobRuntimeLogMeta({ job }),
    });
    await recordDbTaskPlatformEvent(pool, job, {
      stage: 'created',
      eventName: 'job_created',
      status: 'started',
      providerSubmitted: false,
      meta: buildJobRuntimeLogMeta({ job }),
    });
    await mirrorDbJobToTemporalIfEnabled(pool, job);
    jobWorker?.trigger?.();
    json(res, 201, { job });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const pool = await getMysqlPool();
    const jobs = await listJobsForUser(pool, user.id, { limit: url.searchParams.get('limit') || 100 });
    json(res, 200, { jobs });
    return;
  }

  const jobDetailMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const jobResultMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/result$/);
  const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  const jobRetryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);

  if (jobResultMatch && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobResultMatch[1]);
    const body = await readBody(req);
    const resultPatch = body?.result && typeof body.result === 'object' ? body.result : {};
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    const nextResult = await withManagedAssetUserLock(user.id, async (lockedPool) => {
      await assertActiveDbUserUnderManagedAssetLock(lockedPool, user.id, '账号已删除，未更新任务结果');
      const freshJob = await getJobById(lockedPool, job.id);
      if (!freshJob || freshJob.userId !== user.id) {
        const error = new Error('任务已被删除，未更新结果');
        error.code = 'managed_asset_job_unavailable';
        error.statusCode = 404;
        throw error;
      }
      const freshResult = {
        ...(freshJob.result && typeof freshJob.result === 'object' ? freshJob.result : {}),
        ...resultPatch,
      };
      await assertOwnedActiveManagedAssetReferences({
        value: freshResult,
        userId: user.id,
        pool: lockedPool,
      });
      const updateResult = await updateJobFields(lockedPool, freshJob.id, {
        result_json: JSON.stringify(freshResult),
        provider_task_id: String(resultPatch.providerTaskId || freshJob.providerTaskId || ''),
        updated_at: Date.now(),
      });
      if (Number(updateResult?.affectedRows || 0) !== 1) {
        const error = new Error('任务已被删除，未更新结果');
        error.code = 'managed_asset_job_unavailable';
        error.statusCode = 404;
        throw error;
      }
      return freshResult;
    });
    const updatedJob = await getDbJobByIdForUser(user, job.id);
    json(res, 200, { job: updatedJob || { ...job, result: nextResult } });
    return;
  }

  if (jobDetailMatch && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const job = await getDbJobByIdForUser(user, decodeURIComponent(jobDetailMatch[1]));
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    json(res, 200, { job });
    return;
  }

  if (jobDetailMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobDetailMatch[1]);
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 200, { ok: true, alreadyAbsent: true });
      return;
    }
    let jobToDelete = job;
    const deletionAction = resolveJobDeletionAction(jobToDelete);
    if (deletionAction === 'cancel_then_delete' || deletionAction === 'block_active') {
      const cancellation = await requestCancelJob(pool, jobToDelete, {
        user,
        createLog: createDbLog,
        releaseQueuedCredits: async (connection, freshJob, finishedAt) => (
          releaseDbJobCredits({
            pool: connection,
            job: freshJob,
            error: { code: 'request_cancelled', message: '用户删除了排队任务' },
            finishedAt,
            retryWaiting: false,
          })
        ),
      });
      jobToDelete = cancellation.job;
    }
    const deletion = await withManagedAssetUserLock(user.id, (lockedPool) => (
      deleteJobById(lockedPool, jobToDelete.id, {
        userId: user.id,
        hasPendingReservation: async (connection, freshJob) => {
          const reservation = getCreditReservationFromJob(freshJob);
          return Boolean(reservation && !await hasDbProcessedCreditReservation(connection, reservation));
        },
        afterDelete: async (connection, deletedJob) => {
          await queueStoredAssetsAfterReferenceRemoval({
            pool: connection,
            assetIds: collectStoredAssetIdsFromJob(deletedJob),
            reason: 'job_deleted',
            ownerUserId: user.id,
          });
        },
      })
    ));
    if (!deletion?.job) {
      json(res, 200, { ok: true, alreadyAbsent: true });
      return;
    }
    if (deletion.action === 'block_active') {
      json(res, 409, { message: '运行中任务已请求取消，请等待任务进入终态后再删除。', code: 'job_delete_active' });
      return;
    }
    if (deletion.action === 'block_submission_unknown') {
      json(res, 409, { message: '该任务的上游提交状态尚未核实，请先由管理员处置积分预留后再删除。', code: 'job_delete_submission_unknown' });
      return;
    }
    if (deletion.action === 'block_submitted_cancelled') {
      json(res, 409, { message: '该取消任务已提交上游，请先恢复查询并完成积分结算后再删除。', code: 'job_delete_submitted_cancelled' });
      return;
    }
    if (deletion.action === 'block_submitted_recovery') {
      json(res, 409, { message: '该任务正在按原上游任务 ID 恢复查询并结算，完成后会自动删除。', code: 'job_delete_submitted_recovery' });
      return;
    }
    if (deletion.action === 'block_pending_reservation') {
      json(res, 409, { message: '该任务的积分预留尚未结算，请稍后再删除。', code: 'job_delete_pending_reservation' });
      return;
    }
    if (!deletion.deleted) {
      json(res, 409, { message: '任务状态已变化，请刷新后重试。', code: 'job_delete_state_changed' });
      return;
    }
    jobWorker?.cancelActiveJob(job.id);
    await createDbLog({
      user,
      level: 'info',
      module: job.module,
      action: 'job_deleted',
      message: `删除任务：${job.id}`,
      status: 'success',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
      },
    });
    json(res, 200, { ok: true });
    return;
  }

  if (jobCancelMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobCancelMatch[1]);
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    const cancellation = await requestCancelJob(pool, job, {
      user,
      createLog: createDbLog,
      releaseQueuedCredits: async (connection, freshJob, finishedAt) => (
        releaseDbJobCredits({
          pool: connection,
          job: freshJob,
          error: { code: 'request_cancelled', message: '用户取消了排队任务' },
          finishedAt,
          retryWaiting: false,
        })
      ),
    });
    const cancelledJob = cancellation.job;
    await recordDbTaskPlatformEvent(pool, cancelledJob, {
      stage: 'cancelled',
      eventName: 'job_cancel_requested',
      status: 'interrupted',
      providerSubmitted: Boolean(cancelledJob.providerTaskId),
      providerTaskId: cancelledJob.providerTaskId || '',
      errorCode: 'request_cancelled',
      errorMessage: '用户请求取消任务',
      meta: buildJobRuntimeLogMeta({ job: cancelledJob }),
    });
    jobWorker?.cancelActiveJob(cancelledJob.id);
    json(res, 200, { ok: true });
    return;
  }

  if (jobRetryMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobRetryMatch[1]);
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    let submissionPolicy;
    try {
      const prepared = await prepareVoiceoverSubmission({
        body: {
          ...job,
          payload: stripCreditReservationFromPayload(job.payload),
        },
        user,
        pool,
        signal: req.signal,
      });
      submissionPolicy = resolveAuthorizedJobSubmissionPolicy(user, prepared.body, {
        submissionOperation: 'retry',
        voiceoverSourceProbe: prepared.sourceProbe || {},
      });
    } catch (error) {
      respondJobSubmissionPolicyError(res, error);
      return;
    }

    try {
      const retryLockSubmission = job.taskType === 'subtitle_remove_video'
        ? buildSubtitleRemovalUserGuardSubmission(user.id)
        : { userId: user.id, ...job };
      await withMysqlSubmissionLock(pool, retryLockSubmission, async (connection) => withMysqlTransaction(connection, async () => {
        const currentJob = await getJobByIdForUpdate(connection, job.id);
        if (!currentJob || !['failed', 'cancelled'].includes(currentJob.status)) {
          const error = new Error('只有已失败或已取消的任务可以重试。');
          error.code = 'job_retry_not_allowed';
          error.statusCode = 409;
          throw error;
        }
        assertSubmissionKnownBeforeRetry(currentJob);
        if (currentJob.taskType === 'subtitle_remove_video') {
          const guardState = await getSubtitleRemovalSubmissionGuardState(connection, user.id, currentJob.payload);
          assertSubtitleRemovalRetryAllowed({
            activeCount: guardState.activeCount,
            batchMaxItems: getSubtitleRemovalConfig(process.env).batchMaxItems,
          });
        }

        const currentReservation = getCreditReservationFromJob(currentJob);
        const reservationProcessed = currentReservation
          ? await hasDbProcessedCreditReservation(connection, currentReservation)
          : false;
        const reservationAction = getJobCreditRetryReservationAction({
          job: currentJob,
          reservationProcessed,
          providerTaskRecoverable: canRecoverProviderTaskById(currentJob),
        });
        if (reservationAction === 'block') {
          const error = new Error('任务的原积分预留仍在处理中，为防止重复扣费已停止重新提交。');
          error.code = 'job_credit_reservation_pending';
          error.statusCode = 409;
          throw error;
        }

        let replacementReservation = null;
        let retryPayload = currentJob.payload;
        if (reservationAction === 'reserve') {
          const retryJobPayload = {
            module: currentJob.module,
            taskType: submissionPolicy.taskType,
            provider: submissionPolicy.provider,
            payload: stripCreditReservationFromPayload(currentJob.payload),
            maxRetries: submissionPolicy.maxCreateRetries ?? currentJob.maxRetries,
          };
          replacementReservation = await reserveDbJobCredits(connection, user, retryJobPayload);
          retryPayload = attachCreditReservationToJobPayload(retryJobPayload, replacementReservation).payload;
        }

        await updateJobFields(connection, currentJob.id, {
          payload_json: JSON.stringify(retryPayload),
          max_retries: submissionPolicy.maxCreateRetries ?? currentJob.maxRetries,
        });
        await requestRetryJob(connection, { ...currentJob, payload: retryPayload }, {
          resetProviderTaskId: reservationAction === 'reserve',
        });
      }), { timeoutSeconds: getJobSubmissionLockTimeoutSeconds(process.env) });
    } catch (error) {
      if (error?.statusCode) {
        respondJobSubmissionPolicyError(res, error);
        return;
      }
      throw error;
    }
    const retriedJob = await getJobById(pool, job.id);

    await createDbLog({
      user,
      level: 'info',
      module: retriedJob?.module || job.module,
      action: 'job_retry_requested',
      message: `重试任务：${job.id}`,
      status: 'started',
      meta: {
        jobId: job.id,
        providerTaskId: retriedJob?.providerTaskId || job.providerTaskId || '',
        provider: retriedJob?.provider || job.provider,
      },
    });
    await recordDbTaskPlatformEvent(pool, retriedJob || job, {
      stage: 'retry',
      eventName: 'job_retry_requested',
      status: 'started',
      providerSubmitted: Boolean(retriedJob?.providerTaskId || job.providerTaskId),
      providerTaskId: retriedJob?.providerTaskId || job.providerTaskId || '',
      retryable: true,
      meta: buildJobRuntimeLogMeta({ job: retriedJob || job }),
    });
    if (retriedJob) {
      await mirrorDbJobToTemporalIfEnabled(pool, retriedJob);
    }
    if (normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE) !== 'temporal') {
      jobWorker?.trigger?.();
    }
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/jobs/recover' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.providerTaskId || !body?.provider || !body?.taskType) {
      json(res, 400, { message: '恢复任务缺少必要参数。' });
      return;
    }
    const pool = await getMysqlPool();
    const response = await createAuthorizedProviderRecovery({
      userId: user.id,
      request: body,
      findSourceJob: (userId, providerTaskId) => (
        findJobByProviderTaskIdForUser(pool, userId, providerTaskId)
      ),
      createRecoveryJob: async () => {
        const submissionPolicy = resolveAuthorizedJobSubmissionPolicy(
          user,
          body,
          { submissionOperation: 'recover' },
        );
        const recoveredPayload = await scrubDbJobPayloadBeforeSubmission({
          ...body.payload,
          providerTaskId: body.providerTaskId,
        }, user.id);
        const jobPayload = {
          module: body.module || 'system',
          taskType: submissionPolicy.taskType,
          provider: submissionPolicy.provider,
          providerTaskId: body.providerTaskId,
          payload: recoveredPayload,
          maxRetries: submissionPolicy.maxCreateRetries ?? body.maxRetries ?? 1,
        };
        const reusableJob = await findReusableJobRecord(pool, user, jobPayload);
        if (reusableJob) return { statusCode: 200, body: { job: reusableJob, deduped: true } };
        const job = await createJobRecord(pool, user, jobPayload);
        await recordDbTaskPlatformEvent(pool, job, {
          stage: 'created',
          eventName: 'job_recovered',
          status: 'started',
          providerSubmitted: true,
          providerTaskId: body.providerTaskId,
          meta: buildJobRuntimeLogMeta({ job }),
        });
        await mirrorDbJobToTemporalIfEnabled(pool, job);
        jobWorker?.trigger?.();
        return { statusCode: 201, body: { job } };
      },
    });
    json(res, response.statusCode, response.body);
    return;
  }

  json(res, 404, { message: '接口不存在。' });
};

const handleLocalRequest = async (req, res, url, { mutationLockHeld = false } = {}) => {
  if (!mutationLockHeld && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return withLocalStoreMutationLock(() => handleLocalRequest(req, res, url, { mutationLockHeld: true }));
  }
  let store = readLocalStore();
  const userDetailMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  const agentDetailMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  const agentDraftMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/draft$/);
  const agentPublishMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/publish$/);
  const agentRollbackMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/rollback$/);
  const agentVersionsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/versions$/);
  const agentVersionDetailMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)$/);
  const agentVersionValidateMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)\/validate$/);
  const knowledgeBaseDetailMatch = url.pathname.match(/^\/api\/knowledge-bases\/([^/]+)$/);
  const knowledgeDocumentsMatch = url.pathname.match(/^\/api\/knowledge-documents$/);
  const knowledgeDocumentDetailMatch = url.pathname.match(/^\/api\/knowledge-documents\/([^/]+)$/);
  const chatAgentHistoryMatch = url.pathname.match(/^\/api\/chat\/agents\/([^/]+)\/history$/);
  const chatSessionDetailMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  const chatSessionMessagesMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  const studioTrainingMatch = url.pathname.match(/^\/api\/studio\/training\/([^/]+)\/message$/);
  const studioTrainingApplyMatch = url.pathname.match(/^\/api\/studio\/training\/([^/]+)\/apply$/);
  const taskPlatformTimelineMatch = url.pathname.match(/^\/api\/admin\/task-platform\/jobs\/([^/]+)\/timeline$/);
  const taskPlatformSubmissionResolutionMatch = url.pathname.match(/^\/api\/admin\/task-platform\/jobs\/([^/]+)\/submission-resolution$/);

  if (isMediaTranscodeRoute(url, req.method)) {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    await handleMediaTranscodeRequest({ req, res, url, user });
    return;
  }

  const assetRouteMatch = url.pathname.match(ASSET_FILE_ROUTE_REGEX);
  if ((req.method === 'GET' || req.method === 'HEAD') && assetRouteMatch) {
    const assetId = decodeURIComponent(assetRouteMatch[1]);
    await serveStoredAsset(req, res, assetId, {
      accessKey: getManagedAssetAccessKeyFromUrl(url),
      resolveRequestUserId: async () => String(localGetSessionUser(req, store)?.id || ''),
    });
    return;
  }

  if (
    url.pathname.startsWith('/api/virtual-models')
    || url.pathname.startsWith('/api/admin/virtual-models')
  ) {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    if (await handleVirtualModelApiRequest({
      req,
      res,
      url,
      user,
      store,
      persist: () => writeLocalStore(store),
    })) return;
  }

  if (url.pathname === '/api/assets/download-proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    await proxyRemoteDownload(req, res, url.searchParams.get('url') || '');
    return;
  }

  if (url.pathname === '/api/video-diagnosis/probe' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    await handleVideoDiagnosisProbeRequest(req, res);
    return;
  }

  if (url.pathname === '/api/video-diagnosis/analyze' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    await handleVideoDiagnosisAnalyzeRequest(req, res);
    return;
  }

  if (url.pathname === '/api/chatwoot/ai-webhook' && req.method === 'POST') {
    await handleChatwootAiWebhookRequest(req, res, url, getLocalSystemSettings(store));
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = store.users.find(item => item.username === username && item.status === 'active');

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      appendLocalLog(store, {
        user: buildLogActor({ username: username || 'unknown', displayName: username || 'unknown' }),
        level: 'error',
        module: 'account',
        action: 'login_failed',
        message: `登录失败：${username || '未知用户'}`,
        detail: '用户名或密码不正确。',
        status: 'failed',
        meta: { username: username || 'unknown' },
      });
      writeLocalStore(store);
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    user.lastLoginAt = Date.now();
    const token = localCreateSession(store, user.id);
    if (!store.appStates[user.id]) {
      store.appStates[user.id] = createDefaultState();
    }
    appendLocalLog(store, {
      user,
      level: 'info',
      module: 'account',
      action: 'login_success',
      message: '登录成功',
      status: 'success',
      meta: { role: user.role },
    });
    writeLocalStore(store);
    json(res, 200, { token, user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    await assertOwnedActiveManagedAssetReferences({
      value: body?.avatarUrl,
      userId: user.id,
      pool: null,
    });
    if (typeof body?.displayName === 'string') user.displayName = String(body.displayName).trim() || user.username;
    if (body?.avatarUrl === null) user.avatarUrl = '';
    else if (typeof body?.avatarUrl === 'string') user.avatarUrl = String(body.avatarUrl).trim().slice(0, 1024);
    if (body?.avatarPreset === null) user.avatarPreset = 'aurora';
    else if (typeof body?.avatarPreset === 'string') user.avatarPreset = String(body.avatarPreset).trim().slice(0, 40) || 'aurora';
    if (body?.analysisModel !== undefined) user.analysisModel = normalizeUserAnalysisModel(body.analysisModel);
    writeLocalStore(store);
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const token = getTokenFromRequest(req);
    store.sessions = store.sessions.filter(session => session.token !== token);
    appendLocalLog(store, {
      user,
      level: 'info',
      module: 'account',
      action: 'logout',
      message: '退出登录',
      status: 'success',
    });
    writeLocalStore(store);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/smart-factory/preview-turn' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const systemSettings = getLocalSystemSettings(store);
    const result = await runSmartFactoryPreviewTurn({
      message: body.message,
      agentId: body.agentId,
      smartFactoryConfig: composeSmartFactoryConfigForRuntime(systemSettings),
    });
    json(res, 200, { result });
    return;
  }

  if (url.pathname === '/api/smart-factory/config' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const systemSettings = getLocalSystemSettings(store);
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(systemSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/config' && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = mergeSmartFactoryConfigUpdate(currentLocalSettings.smartFactory, body?.smartFactory ?? body?.config ?? body);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      smartFactory: nextSmartFactory,
    });
    writeLocalStore(store);
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-providers' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      modelProviders: upsertModelProvider(currentLocalSettings.modelProviders, body),
    });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-provider-presets' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    json(res, 200, { presets: getModelProviderPresets() });
    return;
  }

  const localSmartFactoryModelProviderMatch = url.pathname.match(/^\/api\/smart-factory\/model-providers\/([^/]+)$/);
  if (localSmartFactoryModelProviderMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      modelProviders: deleteModelProvider(currentLocalSettings.modelProviders, decodeURIComponent(localSmartFactoryModelProviderMatch[1])),
    });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/model-providers/test' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    json(res, 200, await testSmartFactoryModelProviderConnection(body, { env: process.env }));
    return;
  }

  if (url.pathname === '/api/smart-factory/agents' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = createSmartFactoryAgent(currentLocalSettings.smartFactory, body);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const localSmartFactoryAgentMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/([^/]+)$/);
  if (localSmartFactoryAgentMatch && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = updateSmartFactoryAgent(currentLocalSettings.smartFactory, decodeURIComponent(localSmartFactoryAgentMatch[1]), body);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (localSmartFactoryAgentMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const factoryAgentId = decodeURIComponent(localSmartFactoryAgentMatch[1]);
    let nextSmartFactory;
    try {
      nextSmartFactory = deleteSmartFactoryAgent(currentLocalSettings.smartFactory, factoryAgentId);
    } catch (error) {
      json(res, 400, { message: error?.message || '删除智能体失败。' });
      return;
    }
    saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    let agentCenterUnlink = null;
    try {
      agentCenterUnlink = unpublishLinkedAgentCenterAgentLocal(store, factoryAgentId);
    } catch (error) {
      agentCenterUnlink = { error: String(error?.message || error) };
    }
    writeLocalStore(store);
    const nextSettings = getLocalSystemSettings(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }), agentCenterUnlink });
    return;
  }

  const localSmartFactoryAgentPublishMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/([^/]+)\/publish$/);
  if (localSmartFactoryAgentPublishMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const factoryAgentId = decodeURIComponent(localSmartFactoryAgentPublishMatch[1]);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = publishSmartFactoryAgent(currentLocalSettings.smartFactory, factoryAgentId);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    let agentCenterSync = null;
    try {
      agentCenterSync = await syncFactoryAgentToLocalAgentCenter(store, user, composeSmartFactoryConfigForRuntime(nextSettings), factoryAgentId);
    } catch (error) {
      agentCenterSync = { synced: false, syncError: String(error?.message || error) };
    }
    writeLocalStore(store);
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }),
      agentCenterSync,
    });
    return;
  }

  // 接管中心存量智能体(与 DB 段 dbSmartFactoryAdoptMatch 同构,根因#7)
  const localSmartFactoryAdoptMatch = url.pathname.match(/^\/api\/smart-factory\/agents\/adopt\/([^/]+)$/);
  if (localSmartFactoryAdoptMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const centerAgentId = decodeURIComponent(localSmartFactoryAdoptMatch[1]);
    const result = await adoptCenterAgentIntoLocalFactory(store, user, centerAgentId);
    if (result.status !== 200) {
      json(res, result.status, result.body);
      return;
    }
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(result.nextSettings) }),
      ...result.body,
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-bases' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = createSmartFactoryKnowledgeBase(currentLocalSettings.smartFactory, body);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const localSmartFactoryKnowledgeBaseMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-bases\/([^/]+)$/);
  if (localSmartFactoryKnowledgeBaseMatch && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = updateSmartFactoryKnowledgeBase(currentLocalSettings.smartFactory, decodeURIComponent(localSmartFactoryKnowledgeBaseMatch[1]), body);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (localSmartFactoryKnowledgeBaseMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = deleteSmartFactoryKnowledgeBase(currentLocalSettings.smartFactory, decodeURIComponent(localSmartFactoryKnowledgeBaseMatch[1]));
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/chat' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const result = await runSmartFactoryPreviewTurn({
      message: body.message,
      agentId: body.agentId,
      smartFactoryConfig: composeSmartFactoryConfigForRuntime(currentLocalSettings),
    });
    const nextAgentState = appendSmartFactoryConversationTurn(currentLocalSettings.smartFactory, {
      sessionId: body.sessionId,
      userMessage: body.message,
      assistantAnswer: result.answer,
      trace: result.trace,
    });
    const nextSmartFactory = mergeSmartFactoryConfigUpdate(currentLocalSettings.smartFactory, {
      agents: nextAgentState.agents,
      sessions: nextAgentState.sessions,
    });
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      smartFactory: nextSmartFactory,
    });
    writeLocalStore(store);
    json(res, 200, {
      result,
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-documents' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const addedSmartFactory = addSmartFactoryKnowledgeDocument(currentLocalSettings.smartFactory, {
      knowledgeBaseId: body.knowledgeBaseId,
      document: body.document,
    });
    const trainingResult = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(addedSmartFactory, body.knowledgeBaseId, {
      env: process.env,
    });
    const nextSmartFactory = trainingResult.config;
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      smartFactory: nextSmartFactory,
    });
    writeLocalStore(store);
    json(res, 200, {
      config: getSmartFactoryPreviewConfig({
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings),
      }),
    });
    return;
  }

  const localSmartFactoryRetrainDocumentMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-documents\/([^/]+)\/retrain$/);
  if (localSmartFactoryRetrainDocumentMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const documentId = decodeURIComponent(localSmartFactoryRetrainDocumentMatch[1]);
    const retrainedSmartFactory = retrainSmartFactoryKnowledgeDocument(currentLocalSettings.smartFactory, documentId, body);
    const trainingResult = await maybeTrainSmartFactoryKnowledgeDocumentEmbeddings(retrainedSmartFactory, documentId, {
      env: process.env,
    });
    const nextSmartFactory = trainingResult.config;
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const localSmartFactoryDeleteDocumentMatch = url.pathname.match(/^\/api\/smart-factory\/knowledge-documents\/([^/]+)$/);
  if (localSmartFactoryDeleteDocumentMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = deleteSmartFactoryKnowledgeDocument(currentLocalSettings.smartFactory, decodeURIComponent(localSmartFactoryDeleteDocumentMatch[1]));
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  if (url.pathname === '/api/smart-factory/knowledge-search' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    json(res, 200, {
      search: testSmartFactoryKnowledgeSearch({
        query: body.query,
        knowledgeBaseIds: body.knowledgeBaseIds,
        retrievalPolicy: body.retrievalPolicy,
        smartFactoryConfig: composeSmartFactoryConfigForRuntime(currentLocalSettings),
      }),
    });
    return;
  }

  if (url.pathname === '/api/smart-factory/tools' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = upsertSmartFactoryTool(currentLocalSettings.smartFactory, body);
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const localSmartFactoryToolMatch = url.pathname.match(/^\/api\/smart-factory\/tools\/([^/]+)$/);
  if (localSmartFactoryToolMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSmartFactory = deleteSmartFactoryTool(currentLocalSettings.smartFactory, decodeURIComponent(localSmartFactoryToolMatch[1]));
    const nextSettings = saveLocalSystemSettings(store, { ...currentLocalSettings, smartFactory: nextSmartFactory });
    writeLocalStore(store);
    json(res, 200, { config: getSmartFactoryPreviewConfig({ smartFactoryConfig: composeSmartFactoryConfigForRuntime(nextSettings) }) });
    return;
  }

  const localSmartFactoryToolTestMatch = url.pathname.match(/^\/api\/smart-factory\/tools\/([^/]+)\/test$/);
  if (localSmartFactoryToolTestMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const toolName = decodeURIComponent(localSmartFactoryToolTestMatch[1]);
    const currentLocalSettings = getLocalSystemSettings(store);
    const tool = normalizeSmartFactoryConfig(currentLocalSettings.smartFactory).tools.find((item) => item.name === toolName);
    if (!tool) {
      json(res, 404, { error: '工具不存在。' });
      return;
    }
    const messages = tool.type === 'builtin'
      ? await runBuiltinMediaTool({
          executorRef: tool.executorRef,
          args: body || {},
          tool,
          env: process.env,
        })
      : await runAllowedCliTool({
          executorRef: tool.executorRef,
          args: body || {},
          env: process.env,
        });
    json(res, 200, {
      ok: true,
      toolName,
      observation: formatSmartFactoryToolMessagesForTest(messages),
    });
    return;
  }

  if (url.pathname === '/api/chatwoot/test-connection' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await testChatwootConnection(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 连接测试失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversations' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootConversations(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/messages' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootConversationMessages(body || {}, body?.conversationId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/send-message' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await sendChatwootConversationMessage(body || {}, body?.conversationId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 回复发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/send-attachment' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const formData = await readMultipartFormData(req);
      const result = await sendChatwootConversationAttachment({
        baseUrl: formData.get('baseUrl'),
        accountId: formData.get('accountId'),
        inboxId: formData.get('inboxId'),
        apiToken: formData.get('apiToken'),
      }, formData.get('conversationId'), {
        content: formData.get('content'),
        file: formData.get('file'),
        fileName: formData.get('fileName'),
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 附件发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversation-status' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootConversationStatus(body || {}, body?.conversationId, body?.status);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话状态更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/internal-note' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootInternalNote(body || {}, body?.conversationId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 内部备注发送失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/labels' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootLabels(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 标签拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/conversation-labels' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootConversationLabels(body || {}, body?.conversationId, body?.labels);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话标签更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/assignable-agents' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootAssignableAgents(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 坐席拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/teams' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootTeams(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 团队拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/assign-conversation' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await assignChatwootConversation(body || {}, body?.conversationId, {
        assigneeId: body?.assigneeId,
        teamId: body?.teamId,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 会话分配失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/canned-responses' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootCannedResponses(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 话术拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/canned-response' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootCannedResponse(body || {}, {
        shortCode: body?.shortCode,
        content: body?.content,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 话术创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/automation-rules' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootAutomationRules(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 自动化规则拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contacts' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContacts(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户资料拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-notes' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContactNotes(body || {}, body?.contactId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户备注拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-note' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootContactNote(body || {}, body?.contactId, body?.content);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户备注创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-contact' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootContact(body || {}, body?.contactId, {
        name: body?.name,
        email: body?.email,
        phone: body?.phone,
        customAttributes: body?.customAttributes,
        additionalAttributes: body?.additionalAttributes,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户资料更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/contact-conversations' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootContactConversations(body || {}, body?.contactId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 客户历史会话拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/delete-message' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await deleteChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息删除失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/retry-message' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await retryChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息重试失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/translate-message' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await translateChatwootConversationMessage(body || {}, body?.conversationId, body?.messageId, body?.targetLanguage || 'zh_CN');
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 消息翻译失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/macros' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootMacros(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/macro' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootMacro(body || {}, {
        name: body?.name,
        visibility: body?.visibility,
        actions: body?.actions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/execute-macro' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await executeChatwootMacro(body || {}, body?.macroId, body?.conversationIds);
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 宏执行失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/campaigns' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootCampaigns(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 活动拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/campaign' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootCampaign(body || {}, {
        title: body?.title,
        message: body?.message,
        inboxId: body?.inboxId,
        enabled: body?.enabled,
        triggerOnlyDuringBusinessHours: body?.triggerOnlyDuringBusinessHours,
        audience: body?.audience,
        triggerRules: body?.triggerRules,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 活动创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/webhooks' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootWebhooks(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/webhook' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await createChatwootWebhook(body || {}, {
        name: body?.name,
        url: body?.url,
        subscriptions: body?.subscriptions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 创建失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-webhook' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootWebhook(body || {}, body?.webhookId, {
        name: body?.name,
        url: body?.url,
        subscriptions: body?.subscriptions,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot Webhook 更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/inboxes' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootInboxes(body || {});
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 收件箱拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/update-inbox' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await updateChatwootInbox(body || {}, body?.targetInboxId || body?.inboxId, {
        name: body?.name,
        enableAutoAssignment: body?.enableAutoAssignment,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 收件箱更新失败' });
    }
    return;
  }

  if (url.pathname === '/api/chatwoot/reports-summary' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    try {
      const body = await readBody(req);
      const result = await listChatwootReportsSummary(body || {}, {
        since: body?.since,
        until: body?.until,
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 502, { message: error?.message || 'Chatwoot 报表摘要拉取失败' });
    }
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { users: store.users.map(cleanUser) });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'staff';
    const jobConcurrency = normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const featurePermissions = normalizeFeaturePermissions(body.featurePermissions);
    const creditLimitMode = normalizeCreditLimitMode(body.creditLimitMode);
    const creditBalance = normalizeCreditBalanceInput(body.creditBalance);

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    if (store.users.some(user => user.username === username)) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = createUser({ username, password, role, displayName, jobConcurrency, featurePermissions, creditLimitMode, creditBalance });
    store.users.push(newUser);
    store.appStates[newUser.id] = createDefaultState();
    appendLocalLog(store, {
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_created',
      message: `创建账号：${newUser.username}`,
      status: 'success',
      meta: {
        targetUserId: newUser.id,
        targetUsername: newUser.username,
        targetDisplayName: newUser.displayName,
        targetRole: newUser.role,
        targetJobConcurrency: newUser.jobConcurrency,
        targetFeaturePermissions: newUser.featurePermissions,
        targetCreditLimitMode: newUser.creditLimitMode,
        targetCreditBalance: newUser.creditBalance,
      },
    });
    writeLocalStore(store);
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { agents: listLocalAgents(store, admin) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    await assertOwnedActiveManagedAssetReferences({
      value: body?.iconUrl,
      userId: admin.id,
      pool: null,
    });
    const result = createLocalAgent(store, admin, body || {});
    writeLocalStore(store);
    json(res, 201, result);
    return;
  }

  if (agentDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const agent = getLocalAgentById(store, decodeURIComponent(agentDetailMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { agent, versions: listLocalAgentVersionsByAgentId(store, agent.id) });
    return;
  }

  if (agentDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agentId = decodeURIComponent(agentDetailMatch[1]);
    const agentForLock = getLocalAgentById(store, agentId);
    if (!agentForLock || !canManageOwnedResource(admin, agentForLock.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    await assertOwnedActiveManagedAssetReferences({
      value: body?.iconUrl,
      userId: agentForLock.ownerUserId,
      pool: null,
    });
    if (!isStatusOnlyAgentPatch(body)) {
      if (rejectIfFactoryManaged(res, agentForLock)) return;
    }
    const agent = updateLocalAgent(store, admin, agentId, body || {});
    if (!agent) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { agent });
    return;
  }

  if (agentDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const result = await deleteLocalAgent(store, admin, decodeURIComponent(agentDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ...result, message: '智能体已永久删除。' });
    return;
  }

  if (agentDraftMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const agentId = decodeURIComponent(agentDraftMatch[1]);
    const agentForLock = getLocalAgentById(store, agentId);
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const version = createLocalAgentDraft(store, admin, agentId);
    if (!version) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 201, { version });
    return;
  }

  if (agentVersionsMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const agent = getLocalAgentById(store, decodeURIComponent(agentVersionsMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { versions: listLocalAgentVersionsByAgentId(store, agent.id) });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const version = getLocalAgentVersionById(store, decodeURIComponent(agentVersionDetailMatch[1]));
    const agent = version ? getLocalAgentById(store, version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const versionId = decodeURIComponent(agentVersionDetailMatch[1]);
    const versionForLock = getLocalAgentVersionById(store, versionId);
    const agentForLock = versionForLock ? getLocalAgentById(store, versionForLock.agentId) : null;
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const version = updateLocalAgentVersion(store, admin, versionId, body || {});
    if (!version) {
      json(res, 400, { message: '版本不存在、已发布或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const versionId = decodeURIComponent(agentVersionDetailMatch[1]);
    const versionForLock = getLocalAgentVersionById(store, versionId);
    const agentForLock = versionForLock ? getLocalAgentById(store, versionForLock.agentId) : null;
    if (rejectIfFactoryManaged(res, agentForLock)) return;
    const result = deleteLocalAgentVersion(store, admin, versionId);
    if (!result) {
      json(res, 400, { message: '版本不存在、已发布或无权限，不能永久删除。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ...result, message: '版本已永久删除。' });
    return;
  }

  if (agentVersionValidateMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const version = getLocalAgentVersionById(store, decodeURIComponent(agentVersionValidateMatch[1]));
    const agent = version ? getLocalAgentById(store, version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    try {
      const validation = await validateLocalAgentVersionRecord(store, admin, agent, version, String(body?.message || '请用一句话说明这个智能体能做什么。'));
      writeLocalStore(store);
      if (!validation.ok) {
        json(res, 500, { message: validation.errorMessage || '智能体验证失败。' });
        return;
      }
      json(res, 200, { version: validation.version, result: validation.result });
    } catch (error) {
      // helper 内部已 catch 验证错误,此处仅兜持久化异常
      appendLocalLog(store, {
        user: admin,
        level: 'error',
        module: 'agent_center',
        action: 'agent_validate',
        message: `智能体验证失败：${agent.name}`,
        detail: error?.message || '智能体验证失败。',
        status: 'failed',
        meta: buildAgentRuntimeLogMeta({
          agent,
          version,
          requestMode: 'validation',
          error,
        }),
      });
      writeLocalStore(store);
      json(res, 500, { message: error?.message || '智能体验证失败。' });
    }
    return;
  }

  if (agentPublishMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, decodeURIComponent(agentPublishMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    const versions = listLocalAgentVersionsByAgentId(store, agent.id);
    const targetVersion = body?.versionId ? versions.find((item) => item.id === body.versionId) : versions.find((item) => !item.isPublished) || versions[0];
    if (!targetVersion || targetVersion.validationStatus !== 'success') {
      json(res, 400, { message: '发布失败，请先完成成功验证。' });
      return;
    }
    publishLocalAgentVersionRecord(store, agent.id, targetVersion.id);
    writeLocalStore(store);
    json(res, 200, { agent: getLocalAgentById(store, agent.id) });
    return;
  }

  if (agentRollbackMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, decodeURIComponent(agentRollbackMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    const targetVersion = listLocalAgentVersionsByAgentId(store, agent.id).find((item) => item.id === String(body?.versionId || ''));
    if (!targetVersion) {
      json(res, 400, { message: '回滚失败。' });
      return;
    }
    store.agentVersions.forEach((item) => {
      if (item.agentId === agent.id) item.isPublished = item.id === targetVersion.id;
    });
    const rawAgent = store.agents.find((item) => item.id === agent.id);
    rawAgent.currentVersionId = targetVersion.id;
    rawAgent.status = 'published';
    rawAgent.updatedAt = Date.now();
    writeLocalStore(store);
    json(res, 200, { agent: getLocalAgentById(store, agent.id) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { knowledgeBases: listLocalKnowledgeBases(store, admin) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = createLocalKnowledgeBase(store, admin, body || {});
    writeLocalStore(store);
    json(res, 201, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const knowledgeBase = getLocalKnowledgeBaseById(store, decodeURIComponent(knowledgeBaseDetailMatch[1]));
    if (!knowledgeBase || !canManageOwnedResource(admin, knowledgeBase.ownerUserId)) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase, documents: listLocalKnowledgeDocuments(store, admin, knowledgeBase.id) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = updateLocalKnowledgeBase(store, admin, decodeURIComponent(knowledgeBaseDetailMatch[1]), body || {});
    if (!knowledgeBase) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseDetailMatch[1]);
    const deletedCount = deleteLocalKnowledgeBase(store, admin, knowledgeBaseId);
    if (!deletedCount) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedKnowledgeBaseId: knowledgeBaseId, message: '知识库已永久删除。' });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { documents: listLocalKnowledgeDocuments(store, admin, String(url.searchParams.get('knowledgeBaseId') || '')) });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const document = await createLocalKnowledgeDocument(store, admin, body || {});
    if (!document) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 201, { document });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const deletedCount = deleteLocalKnowledgeDocument(store, admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]));
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const document = await updateLocalKnowledgeDocument(store, admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]), body || {});
    if (!document) {
      json(res, 404, { message: '文档不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { document });
    return;
  }

  if (url.pathname === '/api/chat/agents' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const agents = (store.agents || [])
      .filter((item) => item.status === 'published' && item.currentVersionId)
      .map((item) => getLocalAgentById(store, item.id));
    json(res, 200, { agents });
    return;
  }

  if (chatAgentHistoryMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const result = await deleteLocalUserAgentHistory(store, user, decodeURIComponent(chatAgentHistoryMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const agentId = String(url.searchParams.get('agentId') || '');
    const sessions = filterVisibleChatSessions(store.chatSessions || [], { userId: user.id, agentId })
      .map((item) => ({
        ...item,
        selectedModel: String(item.selectedModel || ''),
        reasoningLevel: item.reasoningLevel ? String(item.reasoningLevel) : null,
        webSearchEnabled: Boolean(item.webSearchEnabled),
        lastImageMode: Boolean(item.lastImageMode),
      }));
    json(res, 200, { sessions });
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, String(body?.agentId || ''));
    if (!agent?.currentVersionId || agent.status !== 'published') {
      json(res, 404, { message: '智能体不存在或尚未发布。' });
      return;
    }
    const version = getLocalAgentVersionById(store, agent.currentVersionId);
    const selectedModel = resolveChatSessionModel(version);
    const capability = getChatModelCapability(selectedModel, getPersistentAssetBaseUrl(req));
    const session = {
      id: createEntityId(),
      userId: user.id,
      agentId: agent.id,
      agentVersionId: agent.currentVersionId,
      title: '新会话',
      status: 'active',
      summary: '',
      selectedModel,
      reasoningLevel: resolveSessionReasoningLevel({ capability, requestedReasoningLevel: null }),
      webSearchEnabled: false,
      lastImageMode: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.chatSessions.push(session);
    writeLocalStore(store);
    json(res, 201, { session, openingRemarks: version?.openingRemarks || null });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionDetailMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    const body = await readBody(req);
    const version = getLocalAgentVersionById(store, session.agentVersionId);
    const publicBaseUrl = getPersistentAssetBaseUrl(req);
    const selectedModel = resolveChatSessionModel(version, body?.selectedModel || session.selectedModel);
    const capability = getChatModelCapability(selectedModel, publicBaseUrl);
    const requestedReasoningLevel = Object.prototype.hasOwnProperty.call(body || {}, 'reasoningLevel')
      ? body?.reasoningLevel
      : session.reasoningLevel;
    session.selectedModel = selectedModel || '';
    session.reasoningLevel = resolveSessionReasoningLevel({ capability, requestedReasoningLevel });
    session.webSearchEnabled = capability?.supportsWebSearch ? Boolean(body?.webSearchEnabled) : false;
    session.lastImageMode = Boolean(body?.lastImageMode);
    session.updatedAt = Date.now();
    writeLocalStore(store);
    json(res, 200, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionDetailMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    const sessionMessages = (store.chatMessages || []).filter((item) => item.sessionId === sessionId && item.userId === user.id);
    const deletedAssetIds = collectStoredAssetIdsFromChatMessages(sessionMessages);
    store.chatMessages = (store.chatMessages || []).filter((item) => !(item.sessionId === sessionId && item.userId === user.id));
    store.chatSessions = (store.chatSessions || []).filter((item) => !(item.id === sessionId && item.userId === user.id));
    await deleteStoredAssetsByIdsForUser({
      user,
      assetIds: deletedAssetIds,
      reason: 'chat_session_deleted',
      referenceStore: store,
    });
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedSessionId: sessionId, deletedAssetIds });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    await withLocalStoreMutationLock(async () => {
      const recoveryStore = readLocalStore();
      const recoveryUser = (recoveryStore.users || []).find((item) => item.id === user.id && item.status === 'active');
      const recoverySession = (recoveryStore.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
      const recoveryAgent = recoverySession
        ? (recoveryStore.agents || []).find((item) => item.id === recoverySession.agentId)
        : null;
      if (!recoveryUser || !recoverySession || !recoveryAgent) return;
      const recoveryMessages = (recoveryStore.chatMessages || [])
        .filter((item) => item.sessionId === sessionId && item.userId === user.id)
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      await recoverLocalSubmittedChatImageTasks(recoveryStore, recoveryUser, sessionId, recoveryMessages);
    });
    store = readLocalStore();
    json(res, 200, { messages: (store.chatMessages || []).filter((item) => item.sessionId === sessionId && item.userId === user.id).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)) });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    const version = getLocalAgentVersionById(store, session.agentVersionId);
    const agent = getLocalAgentById(store, session.agentId);
    const body = await readBody(req);
    const localWantsStream = String(req.headers.accept || '').includes('text/event-stream') || body?.stream === true;
    let localStreamHadDelta = false;
    let localStreamStarted = false;
    const sendLocalChatEvent = localWantsStream
      ? (type, payload = {}) => {
          if (res.writableEnded) return;
          if (!localStreamStarted) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              ...(res.__corsHeaders || {}),
            });
            localStreamStarted = true;
            const stopLocalChatHeartbeat = startChatSseHeartbeat(res);
            res.once('close', stopLocalChatHeartbeat);
          }
          const normalizedType = type === 'progress' && payload?.stage ? String(payload.stage) : type;
          if (normalizedType === 'streaming' && payload?.delta) localStreamHadDelta = true;
          res.write(formatChatSseEvent(normalizedType, payload));
        }
      : null;
    if (!version || !agent) {
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: '智能体版本不存在。' });
        res.end();
        return;
      }
      json(res, 404, { message: '智能体版本不存在。' });
      return;
    }
    const content = String(body?.content || '').trim();
    const requestMode = body?.requestMode === 'image_generation' ? 'image_generation' : 'chat';
    const clientRequestId = String(body?.clientRequestId || createEntityId()).trim() || createEntityId();
    const publicBaseUrl = getPersistentAssetBaseUrl(req);
    const selectedModel = resolveChatSessionModel(version, body?.selectedModel || session.selectedModel);
    const capability = getChatModelCapability(selectedModel, publicBaseUrl);
    const attachments = Array.isArray(body?.attachments) ? body.attachments.map((item) => ({
      name: String(item?.name || '').trim() || '附件',
      url: item?.url ? String(item.url) : undefined,
      assetId: item?.assetId ? String(item.assetId) : undefined,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      kind: item?.kind === 'image' ? 'image' : 'file',
    })) : [];
    await assertOwnedActiveManagedAssetReferences({
      value: attachments,
      userId: user.id,
      pool: null,
    });
    if (requestMode === 'image_generation' && attachments.some((item) => item.kind !== 'image')) {
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: '生图模式暂只支持上传图片' });
        res.end();
        return;
      }
      json(res, 400, { message: '生图模式暂只支持上传图片' });
      return;
    }
    const capabilityError = getAttachmentCapabilityError({ capability, attachments, requestMode, modelLabel: `模型 ${selectedModel} ` });
    if (capabilityError) {
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: capabilityError });
        res.end();
        return;
      }
      json(res, 400, { message: capabilityError });
      return;
    }
    if (requestMode !== 'image_generation' && body?.webSearchEnabled && !capability?.supportsWebSearch) {
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: '当前模型不支持联网' });
        res.end();
        return;
      }
      json(res, 400, { message: '当前模型不支持联网' });
      return;
    }
    const existingMessages = (store.chatMessages || [])
      .filter((item) => item.sessionId === sessionId && item.userId === user.id && item.metadata?.clientRequestId === clientRequestId)
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const existingUserMessage = existingMessages.find((item) => item.role === 'user') || null;
    const existingAssistantMessage = existingMessages.find((item) => item.role === 'assistant') || null;
    const activeKey = buildChatRequestKey(sessionId, clientRequestId);
    if (activeLocalChatReplyRequests.has(activeKey)) {
      const response = await activeLocalChatReplyRequests.get(activeKey);
      if (localWantsStream) {
        if (response.status >= 400) {
          sendLocalChatEvent('error', { message: response.body?.message || '聊天回复失败。', code: response.body?.code || '' });
        } else {
          if (!localStreamHadDelta) sendLocalChatEvent('streaming', { delta: response.body.assistantMessage?.content || '' });
          sendLocalChatEvent('done', { assistantMessage: response.body.assistantMessage, usage: response.body.usage });
        }
        res.end();
        return;
      }
      json(res, response.status, response.body);
      return;
    }
    if (existingUserMessage && existingAssistantMessage && !isAgentChatRunPendingMetadata(existingAssistantMessage.metadata)) {
      const responseBody = {
        userMessage: existingUserMessage,
        assistantMessage: existingAssistantMessage,
        usage: {
          idempotent: true,
          clientRequestId,
          selectedModel: existingAssistantMessage.metadata?.selectedModel || existingUserMessage.metadata?.selectedModel || selectedModel,
          requestType: existingAssistantMessage.metadata?.requestMode || existingUserMessage.metadata?.requestMode || requestMode,
          sessionId,
        },
      };
      if (localWantsStream) {
        if (!localStreamHadDelta) sendLocalChatEvent('streaming', { delta: responseBody.assistantMessage?.content || '' });
        sendLocalChatEvent('done', { assistantMessage: responseBody.assistantMessage, usage: responseBody.usage });
        res.end();
        return;
      }
      json(res, 201, responseBody);
      return;
    }
    const activeSessionRun = (store.chatMessages || [])
      .filter((item) => item.sessionId === sessionId && item.userId === user.id && item.role === 'assistant')
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .find((item) => isAgentChatRunPendingMetadata(item.metadata) && getAgentChatClientRequestId(item) !== clientRequestId);
    if (activeSessionRun) {
      if (localWantsStream) {
        const activeRunError = buildActiveAgentChatRunError();
        sendLocalChatEvent('error', { message: activeRunError.message, code: activeRunError.code || 'agent_chat_run_active' });
        res.end();
        return;
      }
      json(res, 409, { message: buildActiveAgentChatRunError().message, code: 'agent_chat_run_active' });
      return;
    }
    if (existingUserMessage && existingAssistantMessage) {
      const responseBody = {
        userMessage: existingUserMessage,
        assistantMessage: existingAssistantMessage,
        usage: {
          idempotent: true,
          pending: true,
          clientRequestId,
          selectedModel: existingAssistantMessage.metadata?.selectedModel || existingUserMessage.metadata?.selectedModel || selectedModel,
          requestType: existingAssistantMessage.metadata?.requestMode || existingUserMessage.metadata?.requestMode || requestMode,
          sessionId,
        },
      };
      if (localWantsStream) {
        if (!localStreamHadDelta) sendLocalChatEvent('streaming', { delta: responseBody.assistantMessage?.content || '' });
        sendLocalChatEvent('done', { assistantMessage: responseBody.assistantMessage, usage: responseBody.usage });
        res.end();
        return;
      }
      json(res, 201, responseBody);
      return;
    }
    let agentImageCreditReservation = null;
    let agentImageCreditSettled = false;
    try {
      agentImageCreditReservation = requestMode === 'image_generation' && !shouldUseToolCallingConversation(version)
        ? reserveLocalAgentImageCredits(store, user, { sessionId, clientRequestId, model: version?.modelPolicy?.multimodalModel })
        : null;
      if (agentImageCreditReservation) writeLocalStore(store);
    } catch (error) {
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: error?.message || '积分不足', code: error?.code || '' });
        res.end();
        return;
      }
      json(res, error?.statusCode || 500, {
        message: error?.message || '积分不足',
        code: error?.code || '',
        requiredCredits: error?.requiredCredits,
        availableCredits: error?.availableCredits,
      });
      return;
    }
    if (localWantsStream) sendLocalChatEvent('thinking', {});
    const promise = (async () => {
    const now = Date.now();
    const userMessageId = createEntityId();
    const assistantMessageId = createEntityId();
    const history = (store.chatMessages || []).filter((item) => item.sessionId === sessionId && item.userId === user.id).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const systemSettings = getUserScopedSystemSettings(getLocalSystemSettings(store), user);
    const imageKnowledgeChunks = requestMode === 'image_generation' && version.retrievalPolicy?.enabled
      ? await searchKnowledgeChunksByVector(content, listLocalKnowledgeChunksForVersion(store, version), {
          ...version.retrievalPolicy,
          topK: Math.min(Number(version.retrievalPolicy?.topK || 3), 3),
          maxChunks: Math.min(Number(version.retrievalPolicy?.maxChunks || 5), 3),
          maxContextChars: Math.min(Number(version.retrievalPolicy?.maxContextChars || 2400), 1800),
        }, process.env, searchKnowledgeChunks)
      : [];
    const runId = `run-${clientRequestId}`;
    const contextTraceBase = {
      sessionId,
      clientRequestId,
      runId,
      requestMode,
      historyMessageCount: history.length,
      recentHistoryMessageIds: history.slice(-8).map((message) => message.id).filter(Boolean),
      summaryUsed: Boolean(session.summary),
      knowledgeChunkCount: requestMode === 'image_generation' ? imageKnowledgeChunks.length : 0,
      attachmentRefs: attachments.map((item) => ({
        name: item.name,
        kind: item.kind,
        url: item.url || '',
        assetId: item.assetId || '',
        mimeType: item.mimeType || '',
      })),
      imageMode: requestMode === 'image_generation',
    };
    const userMessage = {
      id: userMessageId,
      sessionId,
      userId: user.id,
      role: 'user',
      content,
      attachments,
      metadata: {
        selectedModel,
        reasoningLevel: body?.reasoningLevel || null,
        webSearchEnabled: Boolean(body?.webSearchEnabled),
        requestMode,
        clientRequestId,
        runId,
        status: 'pending',
        phase: 'submitted',
        pending: true,
        contextTrace: contextTraceBase,
        messageIds: { userMessageId, assistantMessageId },
      },
      createdAt: now,
    };
    const assistantMessage = {
      id: assistantMessageId,
      sessionId,
      userId: user.id,
      role: 'assistant',
      content: buildPendingAgentChatContent(requestMode),
      attachments: [],
      metadata: {
        selectedModel,
        fallbackFrom: null,
        usedRetrieval: false,
        reasoningLevel: body?.reasoningLevel || null,
        webSearchEnabled: Boolean(body?.webSearchEnabled),
        requestMode,
        clientRequestId,
        runId,
        status: 'pending',
        phase: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
        pending: true,
        progress: true,
        progressStage: requestMode === 'image_generation' ? 'analyzing' : 'thinking',
        contextTrace: contextTraceBase,
        messageIds: { userMessageId, assistantMessageId },
        imagePlan: null,
        imageResultUrls: null,
        retrievalSummary: [],
      },
      createdAt: now + 1,
    };
    store.chatMessages.push(userMessage);
    store.chatMessages.push(assistantMessage);
    session.title = session.title === '新会话' ? content.slice(0, 24) : session.title;
    session.selectedModel = selectedModel || '';
    session.reasoningLevel = capability?.supportsReasoningLevel && body?.reasoningLevel ? String(body.reasoningLevel) : null;
    session.webSearchEnabled = requestMode === 'image_generation' ? false : capability?.supportsWebSearch ? Boolean(body?.webSearchEnabled) : false;
    session.lastImageMode = requestMode === 'image_generation';
    session.updatedAt = now;
    writeLocalStore(store);
    let latestLocalChatProviderTaskCheckpoint = null;
    const persistLocalChatProviderTaskCheckpoint = async (checkpointResult = {}) => {
      const checkpoint = buildSubmittedImageTaskCheckpoint({
        checkpointResult,
        pendingUserMetadata: userMessage.metadata,
        pendingAssistantMetadata: assistantMessage.metadata,
        contextTraceBase,
        requestMode,
        imageKnowledgeChunkCount: imageKnowledgeChunks.length,
      });
      if (!checkpoint) return;
      latestLocalChatProviderTaskCheckpoint = checkpoint.latestCheckpoint;
      userMessage.metadata = checkpoint.userMetadata;
      assistantMessage.content = checkpoint.assistantContent;
      assistantMessage.attachments = [];
      assistantMessage.metadata = checkpoint.assistantMetadata;
      session.updatedAt = Date.now();
      writeLocalStore(store);
    };
    const persistLocalChatImageCheckpoint = async (checkpointResult = {}) => {
      const checkpoint = buildReadyImageCheckpoint({
        checkpointResult,
        pendingUserMetadata: userMessage.metadata,
        pendingAssistantMetadata: assistantMessage.metadata,
        contextTraceBase,
        requestMode,
        imageKnowledgeChunkCount: imageKnowledgeChunks.length,
      });
      if (!checkpoint) return;
      userMessage.metadata = checkpoint.userMetadata;
      assistantMessage.content = checkpoint.assistantContent;
      assistantMessage.attachments = buildAgentImageResultAttachments(checkpoint.imageResultUrls);
      assistantMessage.metadata = checkpoint.assistantMetadata;
      assistantMessage.createdAt = Date.now();
      session.updatedAt = Date.now();
      writeLocalStore(store);
    };
    try {
      let result;
      if (shouldUseToolCallingConversation(version)) {
        const summaryNeeded = history.filter((item) => item.role !== 'system').length > Number(version.contextPolicy.summaryTriggerThreshold || 10);
        const summary = summaryNeeded ? buildConversationSummary(history, Number(version.contextPolicy.maxSummaryChars || 1200)) : (session.summary || '');
        const ctxLimits = resolveContextLimits({
          modelId: selectedModel,
          contextPolicy: version.contextPolicy || {},
        });
        const recentMessages = history
          .slice(-(ctxLimits.maxHistoryRounds * 2))
          .map((message) => ({ role: message.role, content: message.content }));
        const fallbackModels = resolveChatFallbackModels(version, selectedModel);
        const imageCapability = getImageModelCapability(version?.modelPolicy?.multimodalModel);
        const openaiCompatibleEnv = buildOpenAICompatibleRuntimeEnv(process.env, systemSettings);
        const callModel = async ({ messages, tools, toolChoice, maxTokens, onDelta }) => {
          void toolChoice;
          const output = await executeProviderJobWithManagedAssetScrub({
            userId: user.id,
            taskType: 'openai_responses',
            payload: {
              model: selectedModel,
              fallbackModels,
              messages,
              tools,
              reasoningLevel: body?.reasoningLevel || null,
              maxTokens,
            },
          }, openaiCompatibleEnv, new AbortController().signal, {
            onDelta: (delta) => {
              onDelta?.(delta);
              if (sendLocalChatEvent) sendLocalChatEvent('streaming', { delta });
            },
          });
          return {
            content: output?.content ?? output?.result?.content ?? '',
            toolCalls: output?.toolCalls || output?.result?.toolCalls || [],
            finishReason: output?.finishReason || output?.result?.finishReason || '',
            modelUsed: output?.modelUsed || output?.result?.modelUsed || selectedModel,
          };
        };
        const generateImage = async ({ prompt, taskType, inputImageUrls, aspectRatio, model }) => {
          const imageCreditReservation = reserveLocalAgentImageCredits(store, user, { sessionId, clientRequestId, taskType, model });
          if (imageCreditReservation) writeLocalStore(store);
          let imageOutput;
          try {
            imageOutput = await executeProviderJobWithManagedAssetScrub({
              userId: user.id,
              taskType: 'kie_image',
              payload: {
                imageUrls: inputImageUrls,
                prompt,
                model,
                aspectRatio: aspectRatio || 'auto',
                resolution: String(imageCapability?.defaultResolution || '1K'),
              },
            }, process.env, new AbortController().signal, {
              onProviderTaskId: async (providerTaskId) => {
                await persistLocalChatProviderTaskCheckpoint({
                  content: '图片任务已提交，正在生成中。',
                  providerTaskId,
                  selectedModel: model || selectedModel,
                  taskType,
                  inputImageUrls,
                  prompt,
                  size: aspectRatio || 'auto',
                  imagePlan: {
                    requestMode: 'tool_calling',
                    taskType,
                    selectedImageModel: model || '',
                    inputImageUrls,
                    prompt,
                    size: aspectRatio || 'auto',
                    providerTaskId,
                  },
                });
              },
            });
            settleLocalAgentImageCredits(store, imageCreditReservation, { result: imageOutput, sessionId, clientRequestId });
            writeLocalStore(store);
          } catch (error) {
            releaseLocalAgentImageCredits(store, imageCreditReservation, { error, sessionId, clientRequestId });
            writeLocalStore(store);
            throw error;
          }
          const rawUrl = String(imageOutput?.result?.imageUrl || '').trim();
          const persistedUrl = await persistRuntimeRemoteAssetIfEnabled({
            userId: user.id,
            moduleName: 'agent_center',
            assetType: 'result',
            remoteUrl: rawUrl,
            originalName: `${model || 'image_result'}.png`,
            provider: isMaxForAiImageModel(model) ? 'maxforai' : 'kie',
            jobId: normalizeStoredAssetJobId(imageOutput?.providerTaskId || runId || clientRequestId),
          });
          const imageUrl = persistedUrl || rawUrl;
          const providerTaskId = String(imageOutput?.providerTaskId || '');
          return { imageUrl, providerTaskId, creditsConsumed: getProviderCreditsConsumed(imageOutput) };
        };
        result = await runAgentConversationV2({
          systemPrompt: version.systemPrompt || '',
          summary,
          recentMessages,
          currentMessage: content,
          attachments,
          priorMessages: history,
          imageGenerationEnabled: Boolean(version?.modelPolicy?.imageGenerationEnabled),
          imageMode: requestMode === 'image_generation',
          selectedImageModel: String(version?.modelPolicy?.multimodalModel || '').trim(),
          maxInputImages: Number(imageCapability?.maxInputImages || 1),
          contextLimits: ctxLimits,
          hasKnowledgeBase: cleanKnowledgeBaseIds(version?.knowledgeBaseIds).length > 0 && Boolean(version?.retrievalPolicy?.enabled),
          webSearchEnabled: Boolean(body?.webSearchEnabled),
          searchKnowledge: async (query) => searchKnowledgeChunksByVector(
            query,
            listLocalKnowledgeChunksForVersion(store, version),
            version.retrievalPolicy || {},
            process.env,
            searchKnowledgeChunks
          ),
          callModel,
          generateImage,
          onImageResultReady: persistLocalChatImageCheckpoint,
	          prepareModelImageUrl: prepareAgentModelImageUrl(user.id),
          onProgress: (event) => {
            setChatProgress(clientRequestId, event);
          },
        });
        result.usedRetrieval = false;
        result.retrievalSummary = [];
        result.promptTokens = result.promptTokens || 0;
        result.completionTokens = result.completionTokens || 0;
        result.fallbackFrom = null;
      } else {
        result = requestMode === 'image_generation'
          ? await buildImageConversationResult({
              user,
              agent,
              version,
              priorMessages: history,
              currentMessage: content,
              sessionId,
              selectedModelOverride: selectedModel,
              attachments,
              systemSettings,
              knowledgeChunks: imageKnowledgeChunks,
              conversationSummary: session.summary || '',
              onImageReady: persistLocalChatImageCheckpoint,
              runId,
              clientRequestId,
            })
          : await runLocalAgentConversation({
              store,
              user,
              agent,
              version,
              priorMessages: history,
              currentMessage: content,
              sessionId,
              selectedModelOverride: selectedModel,
              attachments,
              reasoningLevel: body?.reasoningLevel || null,
              webSearchEnabled: Boolean(body?.webSearchEnabled),
            });
      }
      if (agentImageCreditReservation) {
        settleLocalAgentImageCredits(store, agentImageCreditReservation, { result, sessionId, clientRequestId });
        agentImageCreditSettled = true;
      }
      result.clientRequestId = clientRequestId;
      const assistantAttachments = buildAgentImageResultAttachments(result.imageResultUrls);
      const completedContextTrace = {
        ...contextTraceBase,
        knowledgeChunkCount: requestMode === 'image_generation'
          ? imageKnowledgeChunks.length
          : Array.isArray(result.retrievalSummary)
            ? result.retrievalSummary.length
            : 0,
      };
      userMessage.metadata = {
        ...userMessage.metadata,
        status: 'completed',
        pending: false,
        contextTrace: completedContextTrace,
      };
      assistantMessage.content = result.content;
      assistantMessage.attachments = assistantAttachments;
      assistantMessage.metadata = {
        selectedModel: result.selectedModel,
        fallbackFrom: result.fallbackFrom || null,
        usedRetrieval: result.usedRetrieval,
        reasoningLevel: body?.reasoningLevel || null,
        webSearchEnabled: Boolean(body?.webSearchEnabled),
        requestMode,
        clientRequestId,
        runId,
        status: 'completed',
        phase: 'completed',
        pending: false,
        progress: false,
        contextTrace: completedContextTrace,
        messageIds: { userMessageId, assistantMessageId },
        imagePlan: result.imagePlan || latestLocalChatProviderTaskCheckpoint?.imagePlan || null,
        imageResultUrls: result.imageResultUrls || null,
        retrievalSummary: result.retrievalSummary || [],
        providerTaskId: result.providerTaskId || result.imagePlan?.providerTaskId || latestLocalChatProviderTaskCheckpoint?.providerTaskId || '',
        finalReplyErrorMessage: result.finalReplyErrorMessage || '',
      };
      assistantMessage.createdAt = Date.now();
      session.title = session.title === '新会话' ? content.slice(0, 24) : session.title;
      session.selectedModel = selectedModel || '';
      session.reasoningLevel = capability?.supportsReasoningLevel && body?.reasoningLevel ? String(body.reasoningLevel) : null;
      session.webSearchEnabled = requestMode === 'image_generation' ? false : capability?.supportsWebSearch ? Boolean(body?.webSearchEnabled) : false;
      session.lastImageMode = requestMode === 'image_generation';
      session.summary = history.length > Number(version.contextPolicy.summaryTriggerThreshold || 10)
        ? buildConversationSummary(history, Number(version.contextPolicy.maxSummaryChars || 1200))
        : (session.summary || '');
      session.updatedAt = Date.now();
      store.agentUsageLogs.push({
        id: createEntityId(),
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        agentId: agent.id,
        agentName: agent.name,
        agentVersionId: version.id,
        sessionId,
        requestType: result.requestType || requestMode,
        selectedModel: result.selectedModel,
        usedRetrieval: result.usedRetrieval,
        retrievalSummaryJson: result.retrievalSummary,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        status: 'success',
        errorMessage: '',
        createdAt: Date.now(),
      });
      appendLocalLog(store, {
        user,
        level: 'info',
        module: 'agent_center',
        action: requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
        message: `${requestMode === 'image_generation' ? '智能体生图' : '智能体对话'}：${agent.name}`,
        status: 'success',
        meta: buildAgentRuntimeLogMeta({ agent, version, result: { ...result, clientRequestId }, requestMode, sessionId, clientRequestId }),
      });
      writeLocalStore(store);
      return { status: 201, body: { userMessage, assistantMessage, usage: result } };
    } catch (error) {
      if (agentImageCreditReservation && !agentImageCreditSettled) {
        releaseLocalAgentImageCredits(store, agentImageCreditReservation, { error, sessionId, clientRequestId });
      }
      const errorMessage = error?.message || '聊天回复失败。';
      userMessage.metadata = {
        ...userMessage.metadata,
        status: 'failed',
        phase: 'failed',
        pending: false,
        errorMessage,
        errorCode: error?.code || '',
      };
      assistantMessage.content = errorMessage;
      assistantMessage.attachments = [];
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        status: 'failed',
        phase: 'failed',
        pending: false,
        progress: false,
        progressStage: 'failed',
        errorMessage,
        errorCode: error?.code || '',
        providerStage: error?.providerStage || '',
        providerStatus: error?.providerStatus || '',
        providerTaskId: error?.providerTaskId || latestLocalChatProviderTaskCheckpoint?.providerTaskId || '',
      };
      appendLocalLog(store, {
        user,
        level: 'error',
        module: 'agent_center',
        action: requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
        message: `${requestMode === 'image_generation' ? '智能体生图失败' : '智能体对话失败'}：${agent.name}`,
        detail: error?.message || '聊天回复失败。',
        status: 'failed',
        meta: buildAgentRuntimeLogMeta({
          agent,
          version,
          requestMode,
          sessionId,
          clientRequestId,
          error,
        }),
      });
      writeLocalStore(store);
      return { status: error?.statusCode || 500, body: { message: errorMessage, code: error?.code || '' } };
    }
    })();
    activeLocalChatReplyRequests.set(activeKey, promise);
    try {
      const response = await promise;
      if (localWantsStream) {
        if (response.status >= 400) {
          sendLocalChatEvent('error', { message: response.body?.message || '聊天回复失败。', code: response.body?.code || '' });
        } else {
          if (!localStreamHadDelta) sendLocalChatEvent('streaming', { delta: response.body.assistantMessage?.content || '' });
          sendLocalChatEvent('done', { assistantMessage: response.body.assistantMessage, usage: response.body.usage });
        }
        res.end();
        return;
      }
      json(res, response.status, response.body);
    } catch (error) {
      if (agentImageCreditReservation && !agentImageCreditSettled) {
        releaseLocalAgentImageCredits(store, agentImageCreditReservation, { error, sessionId, clientRequestId });
        writeLocalStore(store);
      }
      const errorMessage = error?.message || '聊天回复失败。';
      if (localWantsStream) {
        sendLocalChatEvent('error', { message: errorMessage, code: error?.code || '' });
        res.end();
        return;
      }
      json(res, error?.statusCode || 500, {
        message: errorMessage,
        code: error?.code || '',
        requiredCredits: error?.requiredCredits,
        availableCredits: error?.availableCredits,
      });
    } finally {
      activeLocalChatReplyRequests.delete(activeKey);
    }
    return;
  }

  // ── Studio: Training Channel (Local JSON mode) ──
  if (studioTrainingMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const versionId = decodeURIComponent(studioTrainingMatch[1]);
    const body = await readBody(req);
    let agentName = '未知智能体';
    let selectedModel = '';
    let attachments = [];
    try {
      const version = getLocalAgentVersionById(store, versionId);
      if (!version || version.isPublished) {
        json(res, 404, { message: '版本不存在、非草稿或无权限。' });
        return;
      }
      const agent = getLocalAgentById(store, version.agentId);
      if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
        json(res, 404, { message: '版本不存在、非草稿或无权限。' });
        return;
      }
      agentName = agent.name;
      const content = String(body?.content || '').trim();
      if (!content && !(Array.isArray(body?.attachments) && body.attachments.length > 0)) {
        json(res, 400, { message: '消息内容不能为空。' }); return;
      }
      const history = Array.isArray(body?.history) ? body.history : [];
      attachments = Array.isArray(body?.attachments) ? body.attachments : [];
      await assertOwnedActiveManagedAssetReferences({
        value: attachments,
        userId: admin.id,
        pool: null,
      });
      const publicBaseUrl = getPersistentAssetBaseUrl(req);
      selectedModel = resolveChatSessionModel(version, body?.selectedModel || version.defaultChatModel || version.modelPolicy?.defaultModel || '');
      const capability = getChatModelCapability(selectedModel, publicBaseUrl);

      const capabilityError = getAttachmentCapabilityError({ capability, attachments, requestMode: 'chat', modelLabel: `模型 ${selectedModel} ` });
      if (capabilityError) {
        json(res, 400, { message: capabilityError });
        return;
      }
      if (body?.webSearchEnabled && !capability?.supportsWebSearch) {
        json(res, 400, { message: '当前模型不支持联网' });
        return;
      }
      const kbIds = Array.isArray(version.knowledgeBaseIds) ? version.knowledgeBaseIds : [];
      const knowledgeNames = kbIds.map((id) => {
        const kb = (store.knowledgeBases || []).find((k) => k.id === id);
        return kb ? kb.name : '';
      }).filter(Boolean);
      const { manageableKnowledgeBases, manageableKnowledgeDocuments } = buildStudioLocalKnowledgeContext(store, admin);
      const sysPrompt = STUDIO_CONFIG_ASSISTANT_PROMPT({
        agentName: agent.name,
        systemPrompt: version.systemPrompt,
        knowledgeNames,
        manageableKnowledgeBases,
        manageableKnowledgeDocuments,
      });
      const priorMessages = history.map((m) => ({
        id: '',
        sessionId: '',
        userId: '',
        role: m.role,
        content: m.content,
        attachments: Array.isArray(m?.attachments) ? m.attachments.map((item) => ({
          name: String(item?.name || '').trim() || '附件',
          url: item?.url ? String(item.url) : undefined,
          mimeType: item?.mimeType ? String(item.mimeType) : undefined,
          kind: item?.kind === 'image' ? 'image' : 'file',
        })) : [],
        createdAt: 0,
      }));
      const result = await runLocalAgentConversation({
        store,
        user: admin,
        agent,
        version: { ...version, systemPrompt: sysPrompt },
        priorMessages,
        currentMessage: content,
        attachments,
        selectedModelOverride: selectedModel,
        reasoningLevel: body?.reasoningLevel || null,
        webSearchEnabled: Boolean(body?.webSearchEnabled),
      });
      const rawReply = String(result?.content || '').trim();
      const { cleanText, diffs } = parseConfigChanges(rawReply);
      json(res, 200, { reply: cleanText, configDiffs: diffs, updatedVersion: version });
    } catch (error) {
      appendLocalLog(store, {
        user: admin,
        level: 'error',
        module: 'agent_studio',
        action: 'training_message',
        message: `工作室训练失败：${agentName}`,
        detail: error?.message || '训练消息处理失败。',
        status: 'failed',
        meta: {
          versionId,
          selectedModel,
          attachmentKinds: attachments.map((item) => item?.kind === 'image' ? 'image' : 'file'),
          errorCode: error?.code || '',
          providerStage: error?.providerStage || '',
          providerStatus: error?.providerStatus || '',
          providerMessage: error?.providerMessage || '',
        },
      });
      writeLocalStore(store);
      json(res, 500, { message: error?.message || '训练消息处理失败。' });
    }
    return;
  }

  if (studioTrainingApplyMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const versionId = decodeURIComponent(studioTrainingApplyMatch[1]);
    const body = await readBody(req);
    try {
      const result = await applyLocalStudioTrainingChanges(store, admin, versionId, body || {});
      if (!result) {
        json(res, 404, { message: '版本不存在、非草稿或无权限。' });
        return;
      }
      writeLocalStore(store);
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { message: error?.message || '训练改动应用失败。' });
    }
    return;
  }

  // ── Studio: Create Test Session (Local JSON mode) ──
  if (url.pathname === '/api/studio/test/sessions' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agentId = String(body?.agentId || '').trim();
    const versionId = String(body?.versionId || '').trim();
    const agent = getLocalAgentById(store, agentId);
    const version = getLocalAgentVersionById(store, versionId);
    if (!agent || !version || version.agentId !== agentId || version.isPublished || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体或版本不存在，或非草稿版本。' });
      return;
    }
    const selectedModel = resolveChatSessionModel(version);
    const capability = getChatModelCapability(selectedModel, getPersistentAssetBaseUrl(req));
    const session = {
      id: createEntityId(), userId: admin.id, agentId, agentVersionId: versionId,
      title: '工作室测试', status: 'active', summary: '',
      selectedModel,
      reasoningLevel: resolveSessionReasoningLevel({ capability, requestedReasoningLevel: null }), webSearchEnabled: false, lastImageMode: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.chatSessions.push(session);
    writeLocalStore(store);
    json(res, 201, { session });
    return;
  }

  if (url.pathname === '/api/agent-usage' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const rows = listLocalVisibleAgentUsageRows(store, admin).slice(0, 200);
    json(res, 200, { rows });
    return;
  }

  if (url.pathname === '/api/agent-usage/summary' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const rows = listLocalVisibleAgentUsageRows(store, admin);
    json(res, 200, {
      summary: {
        totalCalls: rows.length,
        successCount: rows.filter((row) => row.status === 'success').length,
        failedCount: rows.filter((row) => row.status !== 'success').length,
        activeUsers: new Set(rows.map((row) => row.userId)).size,
        totalEstimatedCost: Number(rows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0).toFixed(6)),
      },
    });
    return;
  }

  if (url.pathname === '/api/admin/task-platform/health' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const health = await getTaskPlatformHealth({ engine: process.env.MEIAO_TASK_ENGINE, temporalAdapter: temporalTaskAdapter });
    json(res, 200, health);
    return;
  }

  if (url.pathname === '/api/admin/task-platform/jobs' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const status = String(url.searchParams.get('status') || '');
    const moduleFilter = String(url.searchParams.get('module') || '');
    const userId = String(url.searchParams.get('userId') || '');
    const taskType = String(url.searchParams.get('taskType') || '');
    const traceId = String(url.searchParams.get('traceId') || '');
    const jobs = (store.jobs || [])
      .filter((job) => !status || status === 'all' || job.status === status)
      .filter((job) => !moduleFilter || moduleFilter === 'all' || job.module === moduleFilter)
      .filter((job) => !userId || userId === 'all' || job.userId === userId)
      .filter((job) => !taskType || String(job.taskType || '').includes(taskType))
      .filter((job) => !traceId || String(job.id || '').includes(traceId) || String(job.payload?.traceId || '').includes(traceId))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const total = jobs.length;
    const pageJobs = jobs.slice((page - 1) * pageSize, page * pageSize);
    json(res, 200, {
      jobs: pageJobs.map((job) => {
        const owner = (store.users || []).find((item) => item.id === job.userId) || {};
        return {
          id: job.id,
          userId: job.userId,
          user: { id: job.userId, username: owner.username || '', displayName: owner.displayName || owner.username || '' },
          module: job.module,
          taskType: job.taskType,
          provider: job.provider,
          status: job.status,
          providerTaskId: job.providerTaskId || '',
          errorCode: job.errorCode || '',
          errorMessage: job.errorMessage || '',
          retryCount: Number(job.retryCount || 0),
          maxRetries: Number(job.maxRetries || 0),
          createdAt: Number(job.createdAt || 0),
          updatedAt: Number(job.updatedAt || 0),
          startedAt: job.startedAt ?? null,
          finishedAt: job.finishedAt ?? null,
          attemptCount: Math.max(0, Number(job.retryCount || 0)) + (job.startedAt ? 1 : 0),
          latestAttemptStatus: job.status,
          latestStage: job.status === 'queued' ? 'created' : job.status,
          latestEventStatus: job.status === 'failed' ? 'failed' : job.status === 'succeeded' ? 'success' : 'started',
          latestEventAt: Number(job.updatedAt || job.createdAt || 0),
          providerSubmitted: Boolean(job.providerTaskId),
          retryable: job.status === 'retry_waiting',
          errorFingerprint: job.errorCode ? `${job.provider}:${job.taskType}:${job.status}:${job.errorCode}` : '',
          workflowId: job.workflowId || '',
          runId: job.runId || '',
          traceId: String(job.payload?.traceId || job.payload?.requestId || job.id || ''),
          submissionResolution: buildSubmissionResolutionCapability({
            status: job.status,
            errorCode: job.errorCode,
            taskType: job.taskType,
            provider: job.provider,
            payload: job.payload,
          }),
        };
      }),
      total,
      page,
      pageSize,
    });
    return;
  }

  if (taskPlatformSubmissionResolutionMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const jobId = decodeURIComponent(taskPlatformSubmissionResolutionMatch[1]);
    let resolution;
    try {
      resolution = resolveLocalSubmissionUnknownJob(store, {
        jobId,
        action: body?.action,
        providerTaskId: body?.providerTaskId,
        actualCreditsConsumed: body?.actualCreditsConsumed,
        verificationNote: body?.verificationNote,
        releaseReservation: (job) => {
          const reservation = getCreditReservationFromJob(job);
          if (!reservation) return null;
          return releaseLocalAccountCredits(store, reservation, {
            module: job.module,
            taskType: job.taskType,
            provider: job.provider,
            reason: 'admin_submission_resolution',
            meta: { adminUserId: admin.id, jobId: job.id },
          });
        },
        settleReservation: (job, settlementInput) => {
          const reservation = getCreditReservationFromJob(job);
          if (!reservation) return { settledAmount: 0, noReservation: true };
          return settleLocalAccountCredits(store, reservation, {
            result: { creditsConsumed: settlementInput.actualCreditsConsumed },
            module: job.module,
            taskType: job.taskType,
            provider: job.provider,
            reason: 'admin_submission_settlement',
            meta: {
              adminUserId: admin.id,
              jobId: job.id,
              verificationNote: settlementInput.verificationNote,
            },
          });
        },
      });
    } catch (error) {
      if (error?.statusCode) {
        json(res, error.statusCode, { message: error.message, code: error.code });
        return;
      }
      throw error;
    }

    appendLocalLog(store, {
      user: admin,
      level: 'info',
      module: resolution.job.module,
      action: 'submission_unknown_resolved',
      message: `管理员人工处置提交状态未知任务：${resolution.job.id}`,
      status: 'success',
      meta: {
        jobId: resolution.job.id,
        action: resolution.action,
        providerTaskId: resolution.job.providerTaskId || '',
        targetUserId: resolution.job.userId,
        ...(resolution.action === 'settle' ? {
          actualCreditsConsumed: Number(body?.actualCreditsConsumed),
          verificationNote: String(body?.verificationNote || '').trim().slice(0, 500),
        } : {}),
      },
    });
    if (resolution.action === 'bind') {
      await startLocalJobWorkflowIfEnabled(store, resolution.job);
      if (!shouldUseTemporalForLocalExecution()) localJobWorker?.trigger?.();
    }
    writeLocalStore(store);
    json(res, 200, resolution);
    return;
  }

  if (taskPlatformTimelineMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const jobId = decodeURIComponent(taskPlatformTimelineMatch[1]);
    const job = (store.jobs || []).find((item) => item.id === jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    const baseEvent = {
      jobId: job.id,
      attemptId: '',
      traceId: String(job.payload?.traceId || job.payload?.requestId || job.id || ''),
      engine: job.taskEngine || normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE),
      providerSubmitted: Boolean(job.providerTaskId),
      retryable: job.status === 'retry_waiting',
      providerTaskId: job.providerTaskId || '',
      workflowId: job.workflowId || '',
      runId: job.runId || '',
      meta: null,
    };
    const events = [
      { ...baseEvent, id: `${job.id}-created`, stage: 'created', eventName: 'job_created', status: 'started', errorCode: '', errorMessage: '', errorFingerprint: '', createdAt: Number(job.createdAt || 0) },
      ...(job.startedAt ? [{ ...baseEvent, id: `${job.id}-started`, stage: 'provider_submit', eventName: 'job_started', status: 'started', errorCode: '', errorMessage: '', errorFingerprint: '', createdAt: Number(job.startedAt || job.updatedAt || 0) }] : []),
      ...(job.finishedAt || job.status === 'failed' || job.status === 'retry_waiting' || job.status === 'cancelled' ? [{
        ...baseEvent,
        id: `${job.id}-final`,
        stage: job.status === 'succeeded' ? 'completed' : job.status === 'cancelled' ? 'cancelled' : 'failed',
        eventName: job.status === 'succeeded' ? 'job_completed' : 'job_failed',
        status: job.status === 'succeeded' ? 'success' : job.status === 'cancelled' ? 'interrupted' : 'failed',
        errorCode: job.errorCode || '',
        errorMessage: job.errorMessage || '',
        errorFingerprint: job.errorCode ? `${job.provider}:${job.taskType}:${job.status}:${job.errorCode}` : '',
        createdAt: Number(job.finishedAt || job.updatedAt || 0),
      }] : []),
    ];
    json(res, 200, {
      job,
      timeline: {
        attempts: job.startedAt ? [{
          id: `${job.id}-attempt-1`,
          jobId: job.id,
          attemptNo: 1,
          engine: baseEvent.engine,
          workflowId: baseEvent.workflowId,
          runId: baseEvent.runId,
          traceId: baseEvent.traceId,
          status: job.status,
          providerTaskId: job.providerTaskId || '',
          errorCode: job.errorCode || '',
          errorMessage: job.errorMessage || '',
          startedAt: Number(job.startedAt || 0),
          finishedAt: job.finishedAt ?? null,
        }] : [],
        events,
      },
    });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, listLocalLogs(store, {
      module: url.searchParams.get('module'),
      userId: url.searchParams.get('userId'),
      status: url.searchParams.get('status'),
      startAt: url.searchParams.get('startAt'),
      endAt: url.searchParams.get('endAt'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }));
    return;
  }

  if (url.pathname === '/api/logs/meta' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, listLocalLogMeta(store));
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 403, { message: '运行日志仅按 7 天保留策略自动清理，禁止手动清理。' });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const log = appendLocalLog(store, {
      user,
      level: body.level === 'error' ? 'error' : 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: String(body.action || 'unknown').slice(0, 100),
      message: String(body.message || '未提供日志描述').slice(0, 1000),
      detail: typeof body.detail === 'string' ? body.detail.slice(0, 10000) : '',
      status: ['success', 'failed', 'started', 'interrupted'].includes(body.status) ? body.status : 'started',
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
    });
    writeLocalStore(store);
    json(res, 201, { ok: true, log });
    return;
  }

  if (url.pathname === '/api/stats/usage' && req.method === 'GET') {
    const viewer = localRequireUser(req, res, store);
    if (!viewer) return;
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const requestedUserId = normalizeLogFilterValue(url.searchParams.get('userId'));
    const userId = viewer.role === 'admin' ? requestedUserId : viewer.id;
    const mod = normalizeLogFilterValue(url.searchParams.get('module'));
    let filtered = store.usageDaily || [];
    if (startDate) filtered = filtered.filter((r) => r.statDate >= startDate);
    if (endDate) filtered = filtered.filter((r) => r.statDate <= endDate);
    if (userId) filtered = filtered.filter((r) => r.userId === userId);
    if (mod) filtered = filtered.filter((r) => r.module === mod);
    let resultRows = [...filtered];
    if (!mod || mod === 'agent_center') {
      let agentRows = viewer.role === 'admin'
        ? listLocalVisibleAgentUsageRows(store, viewer)
        : (store.agentUsageLogs || []).filter((row) => row.userId === viewer.id);
      if (startDate) agentRows = agentRows.filter((r) => new Date(r.createdAt).toISOString().split('T')[0] >= startDate);
      if (endDate) agentRows = agentRows.filter((r) => new Date(r.createdAt).toISOString().split('T')[0] <= endDate);
      if (userId && viewer.role === 'admin') agentRows = agentRows.filter((r) => r.userId === userId);
      resultRows = [...resultRows, ...aggregateAgentUsageStatsRows(agentRows)];
    }
    json(res, 200, { rows: resultRows.sort((a, b) => a.statDate.localeCompare(b.statDate)) });
    return;
  }

  if (url.pathname === '/api/stats/backfill' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const logsByKey = {};
    for (const log of store.logs || []) {
      if (!shouldTrackUsageStatLog(log)) continue;
      const statDate = new Date(log.createdAt).toISOString().split('T')[0];
      const key = `${statDate}|${log.userId}|${log.module}`;
      if (!logsByKey[key]) {
        logsByKey[key] = { statDate, userId: log.userId, username: log.username,
          displayName: log.displayName, module: log.module, successCount: 0, failedCount: 0, interruptedCount: 0, creditsConsumed: 0 };
      }
      if (log.status === 'success') logsByKey[key].successCount++;
      else if (log.status === 'failed') logsByKey[key].failedCount++;
      else if (log.status === 'interrupted') logsByKey[key].interruptedCount++;
      logsByKey[key].creditsConsumed += extractUsageCreditsConsumed(log);
    }
    const recomputeRows = Object.values(logsByKey);
    const recomputeDates = new Set(recomputeRows.map((row) => row.statDate));
    store.usageDaily = [
      ...(store.usageDaily || []).filter((row) => !recomputeDates.has(row.statDate) || !USAGE_MODULES.has(row.module)),
      ...recomputeRows,
    ];
    writeLocalStore(store);
    json(res, 200, { ok: true, upserted: recomputeRows.length });
    return;
  }

  if (userDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = store.users.find(item => item.id === targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    const body = await readBody(req);
    const nextStatus = body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : undefined;
    const nextRole = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : undefined;
    const nextPassword = typeof body.password === 'string' ? String(body.password) : '';
    const nextDisplayName = typeof body.displayName === 'string' ? String(body.displayName) : undefined;
    const nextJobConcurrency = body.jobConcurrency === undefined ? undefined : normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const nextFeaturePermissions = body.featurePermissions === undefined ? undefined : normalizeFeaturePermissions(body.featurePermissions);
    const nextAnalysisModel = body.analysisModel === undefined ? undefined : normalizeUserAnalysisModel(body.analysisModel);
    const nextCreditLimitMode = body.creditLimitMode === undefined ? undefined : normalizeCreditLimitMode(body.creditLimitMode);
    const nextCreditBalance = body.creditBalance === undefined ? undefined : normalizeCreditBalanceInput(body.creditBalance);
    const previousStatus = targetUser.status;

    if (targetUser.id === admin.id && nextStatus === 'disabled') {
      json(res, 400, { message: '不能禁用当前登录管理员。' });
      return;
    }

    const activeAdminCount = store.users.filter(item => item.role === 'admin' && item.status === 'active').length;
    if (targetUser.role === 'admin' && (nextRole === 'staff' || nextStatus === 'disabled') && activeAdminCount <= 1) {
      json(res, 400, { message: '至少要保留一个可用管理员账号。' });
      return;
    }

    await withLocalManagedAssetUserLock(targetUser.id, async () => {
      if (typeof nextDisplayName === 'string') targetUser.displayName = nextDisplayName.trim() || targetUser.username;
      if (nextRole) targetUser.role = nextRole;
      if (nextStatus) targetUser.status = nextStatus;
      if (nextJobConcurrency !== undefined) targetUser.jobConcurrency = nextJobConcurrency;
      if (nextFeaturePermissions !== undefined) targetUser.featurePermissions = normalizeFeaturePermissions(nextFeaturePermissions);
      if (nextAnalysisModel !== undefined) targetUser.analysisModel = nextAnalysisModel;
      if (nextCreditLimitMode !== undefined) targetUser.creditLimitMode = nextCreditLimitMode;
      if (nextCreditBalance !== undefined) targetUser.creditBalance = nextCreditBalance;
      if (nextPassword) {
        const passwordRecord = createPasswordRecord(nextPassword);
        targetUser.passwordHash = passwordRecord.hash;
        targetUser.salt = passwordRecord.salt;
      }

      if (nextStatus === 'disabled' || nextPassword) {
        store.sessions = store.sessions.filter(session => session.userId !== targetUser.id);
      }

      if (nextPassword) {
        appendLocalLog(store, {
          user: admin,
          level: 'info',
          module: 'account',
          action: 'password_reset',
          message: `重置密码：${targetUser.username}`,
          status: 'success',
          meta: {
            targetUserId: targetUser.id,
            targetUsername: targetUser.username,
          },
        });
      }

      if (nextStatus && nextStatus !== previousStatus) {
        appendLocalLog(store, {
          user: admin,
          level: 'info',
          module: 'account',
          action: nextStatus === 'disabled' ? 'user_disabled' : 'user_enabled',
          message: `${nextStatus === 'disabled' ? '禁用' : '启用'}账号：${targetUser.username}`,
          status: 'success',
          meta: {
            targetUserId: targetUser.id,
            targetUsername: targetUser.username,
          },
        });
      }

      writeLocalStore(store);
    });
    json(res, 200, { user: cleanUser(targetUser) });
    return;
  }

  if (userDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = store.users.find(item => item.id === targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    if (targetUser.id === admin.id) {
      json(res, 400, { message: '不能删除当前登录管理员。' });
      return;
    }

    const activeAdminCount = store.users.filter(item => item.role === 'admin' && item.status === 'active').length;
    if (targetUser.role === 'admin' && activeAdminCount <= 1) {
      json(res, 400, { message: '至少要保留一个可用管理员账号。' });
      return;
    }

    await withLocalManagedAssetUserLock(targetUser.id, async () => {
      await queueUserAssetsForCleanup(targetUser.id);

      const deletedAgentIds = new Set((store.agents || []).filter((item) => item.ownerUserId === targetUser.id).map((item) => item.id));
      const deletedVersionIds = new Set((store.agentVersions || []).filter((item) => deletedAgentIds.has(item.agentId) || item.createdBy === targetUser.id).map((item) => item.id));
      const deletedKnowledgeBaseIds = new Set((store.knowledgeBases || []).filter((item) => item.ownerUserId === targetUser.id).map((item) => item.id));
      const deletedChatSessionIds = new Set((store.chatSessions || [])
        .filter((item) => item.userId === targetUser.id || deletedAgentIds.has(item.agentId))
        .map((item) => item.id));

      store.sessions = store.sessions.filter(session => session.userId !== targetUser.id);
      store.jobs = (store.jobs || []).filter((job) => job.userId !== targetUser.id);
      store.logs = normalizeLogs((store.logs || []).filter((log) => log.userId !== targetUser.id));
      store.accountCreditLedger = (store.accountCreditLedger || []).filter((entry) => entry.userId !== targetUser.id);
      store.chatMessages = (store.chatMessages || []).filter((item) => item.userId !== targetUser.id && !deletedChatSessionIds.has(item.sessionId));
      store.chatSessions = (store.chatSessions || []).filter((item) => item.userId !== targetUser.id && !deletedAgentIds.has(item.agentId));
      store.agentUsageLogs = (store.agentUsageLogs || []).filter((item) => item.userId !== targetUser.id && !deletedAgentIds.has(item.agentId));
      store.agentVersions = (store.agentVersions || []).filter((item) => !deletedVersionIds.has(item.id) && !deletedAgentIds.has(item.agentId));
      store.agents = (store.agents || []).filter((item) => item.ownerUserId !== targetUser.id);
      store.knowledgeChunks = (store.knowledgeChunks || []).filter((item) => !deletedKnowledgeBaseIds.has(item.knowledgeBaseId));
      store.knowledgeDocuments = (store.knowledgeDocuments || []).filter((item) => !deletedKnowledgeBaseIds.has(item.knowledgeBaseId));
      store.knowledgeBases = (store.knowledgeBases || []).filter((item) => item.ownerUserId !== targetUser.id);
      store.users = store.users.filter(item => item.id !== targetUser.id);
      delete store.appStates[targetUser.id];
      appendLocalLog(store, {
        user: admin,
        level: 'info',
        module: 'account',
        action: 'user_deleted',
        message: `删除账号并清理账号数据：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
          usageStatsPreserved: true,
        },
      });
      writeLocalStore(store);
    });
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const state = await scrubLocalStateForUnavailableManagedAssets(store.appStates[user.id] || createDefaultState(), user.id);
    json(res, 200, { state: prepareStateForClient(state) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req, { maxBytes: MAX_STATE_BODY_BYTES });
    const incomingState = body.state || createDefaultState();
    const previousState = store.appStates[user.id] || createDefaultState();
    const nextState = await scrubLocalStateBeforeStorage(
      mergeAppStateForStorage(previousState, incomingState),
      user.id,
    );
    store.appStates[user.id] = nextState;
    writeLocalStore(store);
    await queueRemovedStateAssetsForCleanup({ user, previousState, nextState, referenceStore: store });
    json(res, 200, {
      ok: true,
      ...(body.includeCanonicalState ? { state: prepareStateForClient(nextState) } : {}),
    });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const systemSettings = getLocalSystemSettings(store);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), {
        maxConcurrency: getLocalWorkerConcurrency(),
        systemSettings,
        userSettings: { analysisModel: user.analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      analysisModel: body?.analysisModel ?? currentLocalSettings.analysisModel,
      videoAnalysisModel: body?.videoAnalysisModel ?? currentLocalSettings.videoAnalysisModel,
      announcement: mergeSystemAnnouncementUpdate(currentLocalSettings, body?.announcement, admin),
      openaiCompatible: mergeOpenAICompatibleSettingsUpdate(currentLocalSettings, body?.openaiCompatible),
      modelProviders: body?.modelProviders === undefined
        ? currentLocalSettings.modelProviders
        : mergeModelProviderRegistryUpdate(currentLocalSettings.modelProviders, body.modelProviders),
    });
    writeLocalStore(store);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), {
        maxConcurrency: getLocalWorkerConcurrency(),
        systemSettings: nextSettings,
        userSettings: { analysisModel: admin.analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const systemSettings = getLocalSystemSettings(store);
    json(res, 200, {
      registry: getPublicModelProviderRegistry(systemSettings.modelProviders),
      presets: getModelProviderPresets(),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      modelProviders: upsertModelProvider(currentLocalSettings.modelProviders, body),
    });
    writeLocalStore(store);
    json(res, 200, {
      registry: getPublicModelProviderRegistry(nextSettings.modelProviders),
    });
    return;
  }

  const localSystemModelProviderMatch = url.pathname.match(/^\/api\/system\/model-providers\/([^/]+)$/);
  if (localSystemModelProviderMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const currentLocalSettings = getLocalSystemSettings(store);
    const nextSettings = saveLocalSystemSettings(store, {
      ...currentLocalSettings,
      modelProviders: deleteModelProvider(currentLocalSettings.modelProviders, decodeURIComponent(localSystemModelProviderMatch[1])),
    });
    writeLocalStore(store);
    json(res, 200, {
      registry: getPublicModelProviderRegistry(nextSettings.modelProviders),
    });
    return;
  }

  if (url.pathname === '/api/system/model-providers/test' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    json(res, 200, await testSmartFactoryModelProviderConnection(body, { env: process.env }));
    return;
  }

  if (url.pathname === '/api/system/analysis-model/broadcast' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const currentSettings = getLocalSystemSettings(store);
    const analysisModel = updateLocalAllUsersAnalysisModel(store, currentSettings.analysisModel);
    writeLocalStore(store);
    json(res, 200, {
      ok: true,
      analysisModel,
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), {
        maxConcurrency: getLocalWorkerConcurrency(),
        systemSettings: currentSettings,
        userSettings: { analysisModel },
        voiceoverReadiness: voiceoverTranslationReadiness,
        publicBaseUrl: getPersistentAssetBaseUrl(req),
      }),
    });
    return;
  }

  if (url.pathname === '/api/dreamina/status' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { status: await getDreaminaStatus(process.env) });
    return;
  }

  if (url.pathname === '/api/dreamina/login' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const login = await startDreaminaLogin(process.env);
    json(res, 200, { login });
    return;
  }

  if (url.pathname === '/api/dreamina/login/check' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const login = await checkDreaminaLogin({
      deviceCode: body?.deviceCode,
      poll: body?.poll,
      env: process.env,
    });
    const status = await getDreaminaStatus(process.env);
    json(res, 200, { login, status });
    return;
  }

  if (url.pathname === '/api/dreamina/logout' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const result = await logoutDreamina(process.env);
    const status = await getDreaminaStatus(process.env);
    json(res, 200, { ok: true, result, status });
    return;
  }

  if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req, { maxBytes: getManagedImageJsonBodyMaxBytes() });
    const base64Data = String(body.base64Data || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const originalFileName = String(body.fileName || 'upload.bin').trim();
    const assetType = String(body.assetType || 'source').trim().toLowerCase();
    if (!base64Data) {
      json(res, 400, { message: '上传内容不能为空。' });
      return;
    }

    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName: String(body.module || 'system').slice(0, 60),
      assetType,
      fileName: originalFileName,
      mimeType,
      fileBuffer: Buffer.from(base64Data, 'base64'),
    });
    if (persisted) {
      appendLocalLog(store, {
        user,
        level: 'info',
        module: String(body.module || 'system').slice(0, 60),
        action: 'asset_persisted',
        message: `素材上传成功：${originalFileName}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: stripManagedAssetAccessKey(persisted.publicUrl),
        },
      });
      writeLocalStore(store);
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const uploadJob = createLocalJobRecord(store, user, {
      module: String(body.module || 'system').slice(0, 60),
      taskType: 'upload_asset',
      provider: 'kie',
      payload: {
        base64Data,
        mimeType,
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizeUploadFileName(originalFileName)}`,
        uploadPath,
      },
      maxRetries: 1,
    });

    writeLocalStore(store);

    const result = await executeProviderJobWithManagedAssetScrub(uploadJob, process.env, new AbortController().signal);
    const finishStore = readLocalStore();
    markLocalJobCompleted(finishStore, uploadJob.id, result, false);
    appendLocalLog(finishStore, {
      user,
      level: 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: 'upload_asset',
      message: `素材上传成功：${originalFileName}`,
      status: 'success',
      meta: {
        jobId: uploadJob.id,
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    writeLocalStore(finishStore);
    json(res, 200, {
      fileUrl: result?.result?.fileUrl || '',
    });
    return;
  }

  if (url.pathname === '/api/assets/upload-stream' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const formData = await readMultipartFormData(req, { inspectManagedImage: true });
    const file = formData.get('file');
    const moduleName = String(formData.get('module') || 'system').slice(0, 60);
    const assetType = String(formData.get('assetType') || 'source').trim().toLowerCase();
    if (!(file instanceof File)) {
      json(res, 400, { message: '上传文件不能为空。' });
      return;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName,
      assetType,
      fileName: file.name || 'upload.bin',
      mimeType: file.type || 'application/octet-stream',
      fileBuffer,
    });
    if (persisted) {
      appendLocalLog(store, {
        user,
        level: 'info',
        module: moduleName,
        action: 'asset_persisted',
        message: `素材上传成功：${file.name || 'upload.bin'}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: stripManagedAssetAccessKey(persisted.publicUrl),
        },
      });
      writeLocalStore(store);
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const result = await executeProviderJobWithManagedAssetScrub({
      taskType: 'upload_asset',
      payload: {
        fileBuffer,
        mimeType: file.type || 'application/octet-stream',
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizeUploadFileName(file.name || 'upload.bin')}`,
        uploadPath,
      },
    }, process.env, new AbortController().signal);

    appendLocalLog(store, {
      user,
      level: 'info',
      module: moduleName,
      action: 'upload_asset',
      message: `素材上传成功：${file.name || 'upload.bin'}`,
      status: 'success',
      meta: {
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    writeLocalStore(store);
    json(res, 200, { fileUrl: result?.result?.fileUrl || '' });
    return;
  }

  if (url.pathname === '/api/assets/by-url' && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    try {
      const result = await deleteStoredAssetForUser({ user, fileUrl: body?.fileUrl });
      appendLocalLog(store, {
        user,
        level: 'info',
        module: 'xhs_cover',
        action: 'delete_project',
        message: result.deleted ? '删除小红书封面素材成功' : '小红书封面素材已不存在',
        status: 'success',
        meta: {
          assetId: result.assetId,
          fileUrl: stripManagedAssetAccessKey(body?.fileUrl),
        },
      });
      writeLocalStore(store);
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { message: error instanceof Error ? error.message : '删除素材失败' });
    }
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    let body = await readBody(req);
    if (!body?.taskType || !body?.provider) {
      json(res, 400, { message: '任务类型和 provider 不能为空。' });
      return;
    }
    let submissionPolicy;
    try {
      const prepared = await prepareVoiceoverSubmission({
        body,
        user,
        signal: req.signal,
      });
      body = prepared.body;
      submissionPolicy = resolveAuthorizedJobSubmissionPolicy(user, body, {
        voiceoverSourceProbe: prepared.sourceProbe || {},
      });
    } catch (error) {
      respondJobSubmissionPolicyError(res, error);
      return;
    }

    const jobPayload = {
      module: body.module,
      taskType: submissionPolicy.taskType,
      provider: submissionPolicy.provider,
      payload: await scrubLocalJobPayloadBeforeSubmission(
        await createLibraryModelJobPayload({ payload: body.payload, store, user }),
        user.id,
      ),
      priority: body.priority,
      maxRetries: submissionPolicy.maxCreateRetries ?? normalizeJobMaxRetries(body.taskType, body.maxRetries),
    };
    const reusableJob = findReusableLocalJobRecord(store, user, jobPayload, submissionPolicy.dedupeWindowMs);
    if (reusableJob) {
      json(res, 200, { job: reusableJob, deduped: true });
      return;
    }
    if (jobPayload.taskType === 'subtitle_remove_video') {
      assertSubtitleRemovalBatchSubmissionAllowed({
        jobs: store.jobs,
        userId: user.id,
        payload: jobPayload.payload,
        batchMaxItems: getSubtitleRemovalConfig(process.env).batchMaxItems,
      });
    }
    const creditReservation = reserveLocalJobCredits(store, user, jobPayload);
    const job = createLocalJobRecord(store, user, attachCreditReservationToJobPayload(jobPayload, creditReservation));
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_created',
      message: `创建任务：${job.taskType}`,
      status: 'started',
      meta: buildJobRuntimeLogMeta({ job }),
    });
    await startLocalJobWorkflowIfEnabled(store, job);
    writeLocalStore(store);
    if (!shouldUseTemporalForLocalExecution()) {
      localJobWorker?.trigger?.();
    }
    json(res, 201, { job: getLocalJobById(store, job.id) || job });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobs = listLocalJobsForUser(store, user.id, { limit: url.searchParams.get('limit') || 100 });
    json(res, 200, { jobs });
    return;
  }

  const jobDetailMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const jobResultMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/result$/);
  const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  const jobRetryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);

  if (jobResultMatch && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobResultMatch[1]);
    const body = await readBody(req);
    const resultPatch = body?.result && typeof body.result === 'object' ? body.result : {};
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    const updatedJob = updateLocalJobResult(store, job.id, resultPatch);
    writeLocalStore(store);
    json(res, 200, { job: updatedJob || job });
    return;
  }

  if (jobDetailMatch && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const job = getLocalJobByIdForUser(user, decodeURIComponent(jobDetailMatch[1]));
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    json(res, 200, { job });
    return;
  }

  if (jobDetailMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobDetailMatch[1]);
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 200, { ok: true, alreadyAbsent: true });
      return;
    }
    let jobToDelete = job;
    const resolveLocalDeletionAction = (candidate) => {
      const reservation = getCreditReservationFromJob(candidate);
      return resolveJobDeletionAction(candidate, {
        pendingReservation: Boolean(
          reservation && getLocalCreditReservationState(store, reservation) === 'pending'
        ),
      });
    };
    const deletionAction = resolveLocalDeletionAction(jobToDelete);
    if (deletionAction === 'cancel_then_delete' || deletionAction === 'block_active') {
      jobToDelete = requestLocalCancelJob(store, jobToDelete.id) || jobToDelete;
      if (deletionAction === 'cancel_then_delete') {
        releaseLocalJobCredits({
          store,
          job,
          error: { code: 'request_cancelled', message: '用户删除了排队任务' },
          retryWaiting: false,
        });
      }
    }
    const freshDeletionAction = resolveLocalDeletionAction(jobToDelete);
    if (freshDeletionAction === 'block_active') {
      writeLocalStore(store);
      localJobWorker?.cancelActiveJob(jobToDelete.id);
      json(res, 409, { message: '运行中任务已请求取消，请等待任务进入终态后再删除。', code: 'job_delete_active' });
      return;
    }
    if (freshDeletionAction === 'block_submission_unknown') {
      json(res, 409, { message: '该任务的上游提交状态尚未核实，请先处置积分预留后再删除。', code: 'job_delete_submission_unknown' });
      return;
    }
    if (freshDeletionAction === 'block_submitted_cancelled') {
      json(res, 409, { message: '该取消任务已提交上游，请先恢复查询并完成积分结算后再删除。', code: 'job_delete_submitted_cancelled' });
      return;
    }
    if (freshDeletionAction === 'block_submitted_recovery') {
      json(res, 409, { message: '该任务正在按原上游任务 ID 恢复查询并结算，完成后会自动删除。', code: 'job_delete_submitted_recovery' });
      return;
    }
    if (freshDeletionAction === 'block_pending_reservation') {
      json(res, 409, { message: '该任务的积分预留尚未结算，请稍后再删除。', code: 'job_delete_pending_reservation' });
      return;
    }
    deleteLocalJobRecord(store, jobToDelete.id);
    await deleteStoredAssetsByIdsForUser({
      user,
      assetIds: collectStoredAssetIdsFromJob(jobToDelete),
      reason: 'job_deleted',
      referenceStore: store,
    });
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_deleted',
      message: `删除任务：${job.id}`,
      status: 'success',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
      },
    });
    writeLocalStore(store);
    localJobWorker?.cancelActiveJob(job.id);
    json(res, 200, { ok: true });
    return;
  }

  if (jobCancelMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobCancelMatch[1]);
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    requestLocalCancelJob(store, jobId);
    if (job.status === 'queued' || job.status === 'retry_waiting') {
      releaseLocalJobCredits({ store, job, error: { code: 'request_cancelled', message: '用户取消了排队任务' }, retryWaiting: false });
    }
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_cancel_requested',
      message: `请求取消任务：${job.id}`,
      status: 'interrupted',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
        jobCreatedAt: job.createdAt,
      },
    });
    writeLocalStore(store);
    localJobWorker?.cancelActiveJob(job.id);
    json(res, 200, { ok: true });
    return;
  }

  if (jobRetryMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobRetryMatch[1]);
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    if (!['failed', 'cancelled'].includes(job.status)) {
      json(res, 409, { message: '只有已失败或已取消的任务可以重试。', code: 'job_retry_not_allowed' });
      return;
    }
    try {
      assertSubmissionKnownBeforeRetry(job);
      if (job.taskType === 'subtitle_remove_video') {
        assertSubtitleRemovalRetryAllowed({
          jobs: store.jobs,
          userId: user.id,
          batchMaxItems: getSubtitleRemovalConfig(process.env).batchMaxItems,
        });
      }
    } catch (error) {
      respondJobSubmissionPolicyError(res, error);
      return;
    }
    let submissionPolicy;
    try {
      const prepared = await prepareVoiceoverSubmission({
        body: {
          ...job,
          payload: stripCreditReservationFromPayload(job.payload),
        },
        user,
        signal: req.signal,
      });
      submissionPolicy = resolveAuthorizedJobSubmissionPolicy(user, prepared.body, {
        submissionOperation: 'retry',
        voiceoverSourceProbe: prepared.sourceProbe || {},
      });
    } catch (error) {
      respondJobSubmissionPolicyError(res, error);
      return;
    }
    const currentReservation = getCreditReservationFromJob(job);
    const reservationAction = getJobCreditRetryReservationAction({
      job,
      reservationProcessed: getLocalCreditReservationState(store, currentReservation) === 'processed',
      providerTaskRecoverable: canRecoverProviderTaskById(job),
    });
    if (reservationAction === 'block') {
      json(res, 409, {
        message: '任务的原积分预留仍在处理中，为防止重复扣费已停止重新提交。',
        code: 'job_credit_reservation_pending',
      });
      return;
    }

    let replacementReservation = null;
    let retryPayload = job.payload;
    if (reservationAction === 'reserve') {
      const retryJobPayload = {
        module: job.module,
        taskType: submissionPolicy.taskType,
        provider: submissionPolicy.provider,
        payload: stripCreditReservationFromPayload(job.payload),
        maxRetries: submissionPolicy.maxCreateRetries ?? job.maxRetries,
      };
      replacementReservation = reserveLocalJobCredits(store, user, retryJobPayload);
      retryPayload = attachCreditReservationToJobPayload(retryJobPayload, replacementReservation).payload;
    }
    const retriedJob = requestLocalRetryJob(store, jobId, {
      payload: retryPayload,
      maxRetries: submissionPolicy.maxCreateRetries ?? job.maxRetries,
      resetProviderTaskId: reservationAction === 'reserve',
    });
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_retried',
      message: `重新排队任务：${job.id}`,
      status: 'started',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
        jobCreatedAt: job.createdAt,
      },
    });
    if (retriedJob) {
      try {
        await startLocalJobWorkflowIfEnabled(store, retriedJob);
      } catch (error) {
        if (replacementReservation) {
          releaseLocalAccountCredits(store, replacementReservation, {
            reason: 'job_retry_prepare_failed',
            errorCode: error?.code || '',
          });
        }
        throw error;
      }
    }
    writeLocalStore(store);
    if (!shouldUseTemporalForLocalExecution()) {
      localJobWorker?.trigger?.();
    }
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/jobs/recover' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.providerTaskId || !body?.provider || !body?.taskType) {
      json(res, 400, { message: '恢复任务缺少必要参数。' });
      return;
    }
    const response = await createAuthorizedProviderRecovery({
      userId: user.id,
      request: body,
      findSourceJob: (userId, providerTaskId) => (
        findLocalJobByProviderTaskIdForUser(store, userId, providerTaskId)
      ),
      createRecoveryJob: async () => {
        const submissionPolicy = resolveAuthorizedJobSubmissionPolicy(
          user,
          body,
          { submissionOperation: 'recover' },
        );
        const recoveredPayload = await scrubLocalJobPayloadBeforeSubmission({
          ...body.payload,
          providerTaskId: body.providerTaskId,
        }, user.id);
        const jobPayload = {
          module: body.module || 'system',
          taskType: submissionPolicy.taskType,
          provider: submissionPolicy.provider,
          providerTaskId: body.providerTaskId,
          payload: recoveredPayload,
          maxRetries: submissionPolicy.maxCreateRetries ?? body.maxRetries ?? 1,
        };
        const reusableJob = findReusableLocalJobRecord(store, user, jobPayload);
        if (reusableJob) return { statusCode: 200, body: { job: reusableJob, deduped: true } };
        const job = createLocalJobRecord(store, user, jobPayload);
        await startLocalJobWorkflowIfEnabled(store, job);
        writeLocalStore(store);
        if (!shouldUseTemporalForLocalExecution()) localJobWorker?.trigger?.();
        return { statusCode: 201, body: { job: getLocalJobById(store, job.id) || job } };
      },
    });
    json(res, response.statusCode, response.body);
    return;
  }

  json(res, 404, { message: '接口不存在。' });
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  res.__corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true });
    return;
  }

  const finishDeployRequestTracking = beginDeployRequestTracking({
    pathname: url.pathname,
    method: req.method,
  });
  try {
    assertDeployRequestAllowed({ pathname: url.pathname, method: req.method });

    if (url.pathname === '/api/health' && req.method === 'GET') {
      const taskEngine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
      const subtitleRemovalConfig = getSubtitleRemovalConfig(process.env);
      const voiceoverHealth = buildVoiceoverHealthSnapshot(
        process.env,
        voiceoverTranslationReadiness,
      );
      // worker 字段暴露 Temporal poller 存活状态(S1):poller 静默死亡时 HTTP 仍活着,
      // 只看 ok:true 会误判健康。health 本身永远 HTTP 200,消费方看 worker.healthy。
      const worker = taskEngine === 'temporal'
        ? await getWorkerHealthSnapshot()
        : { healthy: true, engine: taskEngine };
      // creditAlert 只在有余额告警记录时出现(S3),保持无事时 health 干净。
      const creditAlert = getCreditAlertSnapshot();
      const mediaTranscodeStatus = await mediaTranscodeApi.status();
      json(res, 200, {
        ok: true,
        release: processRelease,
        deployment: getDeployRequestSnapshot(),
        mode: shouldUseMysql ? 'internal-mysql-v1' : 'internal-v1',
        taskEngine,
        worker,
        managedImageUpload: getManagedImageUploadHealth({ env: process.env }),
        managedAssetCleanup,
        tombstonedJobCleanup,
        mediaTranscode: {
          enabled: mediaTranscodeReadiness.enabled,
          ffmpegReady: mediaTranscodeReadiness.ffmpegReady,
          ffprobeReady: mediaTranscodeReadiness.ffprobeReady,
          active: mediaTranscodeStatus.active,
          queued: mediaTranscodeStatus.queued,
          sessions: mediaTranscodeStatus.sessions,
        },
        subtitleRemoval: {
          enabled: subtitleRemovalConfig.enabled,
          configured: subtitleRemovalConfig.configured,
        },
        voiceoverTranslation: {
          enabled: voiceoverHealth.enabled,
          ready: voiceoverHealth.ready,
          pythonReady: voiceoverHealth.pythonReady,
          modelReady: voiceoverHealth.modelReady,
          ffmpegReady: voiceoverHealth.ffmpegReady,
          separationConcurrency: voiceoverHealth.separationConcurrency,
        },
        ...(Object.keys(creditAlert).length ? { creditAlert } : {}),
      });
      return;
    }

    const chatProgressRouteMatch = url.pathname.match(/^\/api\/chat\/progress\/([^/]+)$/);
    if (chatProgressRouteMatch && req.method === 'GET') {
      const clientRequestId = decodeURIComponent(chatProgressRouteMatch[1]);
      const progress = chatProgressMap.get(clientRequestId) || null;
      json(res, 200, { progress });
      return;
    }

    if (!url.pathname.startsWith('/api/') && tryServeFrontend(req, res, url)) {
      return;
    }

    if (shouldUseMysql) {
      await handleMysqlRequest(req, res, url);
      return;
    }

    await handleLocalRequest(req, res, url);
  } catch (error) {
    console.error(error);
    if (error.message === 'REQUEST_MULTIPART_BODY_TOO_LARGE') {
      json(res, 413, { message: '上传内容超过服务端限制，请压缩后重试。' });
      return;
    }
    if (error.message === 'REQUEST_BODY_TOO_LARGE') {
      json(res, 413, { message: '请求内容过大，请压缩后重试。' });
      return;
    }
    if (/^media_/.test(String(error?.code || ''))) {
      const statusCode = error.code === 'media_session_forbidden'
        ? 403
        : ['media_session_not_found', 'media_session_expired'].includes(error.code)
          ? 404
          : ['media_input_too_large', 'media_output_too_large'].includes(error.code)
            ? 413
            : error.code === 'media_session_capacity_reached'
              ? 429
              : ['media_transcode_disabled', 'media_process_timeout', 'media_process_failed', 'media_probe_failed'].includes(error.code)
                ? 503
                : 400;
      json(res, statusCode, {
        message: error.message || '媒体处理失败，请重试。',
        code: error.code,
        retryable: statusCode === 429 || statusCode >= 500,
      });
      return;
    }
    if (error?.code === 'account_credit_insufficient') {
      json(res, error.statusCode || 402, {
        message: error.message,
        code: error.code,
        requiredCredits: error.requiredCredits,
        availableCredits: error.availableCredits,
      });
      return;
    }
    if (error?.statusCode && error?.code && /^(job_|video_feature_)/.test(String(error.code))) {
      json(res, error.statusCode, {
        message: error.message || '任务提交被服务端拒绝。',
        code: error.code,
        retryable: error.retryable === true,
      });
      return;
    }
    if (error?.statusCode && /^managed_asset_/.test(String(error?.code || ''))) {
      json(res, error.statusCode, {
        message: error.message || '托管素材操作失败。',
        code: error.code,
        retryable: ['managed_asset_user_lock_timeout', 'managed_asset_lifecycle_lock_timeout', 'managed_asset_agent_busy', 'managed_asset_object_missing'].includes(error.code),
      });
      return;
    }
    if (/^managed_image_(?:upload_failed|upload_disabled)$/.test(String(error?.code || ''))) {
      json(res, 503, {
        message: error.message || '图片上传暂时失败，请稍后重试。',
        code: error.code,
        retryable: true,
      });
      return;
    }
    if (error?.statusCode && /^managed_image_/.test(String(error?.code || ''))) {
      json(res, error.statusCode, {
        message: error.message || '图片上传内容无效。',
        code: error.code,
        retryable: false,
      });
      return;
    }
    json(res, 500, { message: '服务端处理失败。', detail: error.message });
  } finally {
    finishDeployRequestTracking();
  }
});

const stopRuntimeWorkers = () => {
  jobWorker?.stop?.();
  localJobWorker?.stop?.();
};

const clearRuntimeTimers = () => {
  if (assetCleanupTimer) clearInterval(assetCleanupTimer);
  if (managedImageProbeTimer) clearInterval(managedImageProbeTimer);
  if (tombstonedJobReconcilerTimer) clearInterval(tombstonedJobReconcilerTimer);
  if (logCleanupTimer) clearInterval(logCleanupTimer);
  if (staleRunningJobReconcilerTimer) clearTimeout(staleRunningJobReconcilerTimer);
  assetCleanupTimer = null;
  managedImageProbeTimer = null;
  tombstonedJobReconcilerTimer = null;
  logCleanupTimer = null;
  staleRunningJobReconcilerTimer = null;
};

const shutdownTemporalWorker = async () => {
  const runtime = temporalWorkerRuntime;
  temporalWorkerRuntime = null;
  await runtime?.shutdown?.();
};

const closeMysqlPools = async () => {
  const pools = [mysqlPool, mysqlManagedAssetLockPool].filter(Boolean);
  mysqlPool = null;
  mysqlManagedAssetLockPool = null;
  mysqlPoolHealthCheckPromise = null;
  for (const pool of pools) await pool.end?.().catch(() => null);
};

const gracefulShutdown = createGracefulShutdown({
  server,
  stopWorkers: [stopRuntimeWorkers],
  clearTimers: [clearRuntimeTimers],
  shutdownTemporal: shutdownTemporalWorker,
  closePools: [closeMysqlPools],
});
registerProcessShutdown({ shutdown: gracefulShutdown });

const bootstrap = async () => {
  await mediaTranscodeSessionStore.cleanupExpired();
  mediaTranscodeReadiness = await mediaTranscodeApi.readiness();
  if (mediaTranscodeReadiness.enabled && (!mediaTranscodeReadiness.ffmpegReady || !mediaTranscodeReadiness.ffprobeReady)) {
    console.warn('[media-transcode] runtime is enabled but a binary readiness check failed', mediaTranscodeReadiness);
  }
  if (getVoiceoverConfig(process.env).enabled) {
    voiceoverTranslationReadiness = await checkVoiceoverSeparationReadiness({
      env: process.env,
    });
    if (!voiceoverTranslationReadiness.ready) {
      console.warn('[voiceover] runtime is enabled but local separation readiness failed', {
        pythonReady: voiceoverTranslationReadiness.pythonReady,
        modelReady: voiceoverTranslationReadiness.modelReady,
        ffmpegReady: voiceoverTranslationReadiness.ffmpegReady,
      });
    }
  }
  if (shouldUseMysql) {
    await ensureMysqlSchema();
    const pool = await getMysqlPool();
    const taskEngine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
    if (taskEngine !== 'temporal') {
      const reconciledJobs = await reconcileRestartedRunningJobs(pool);
      if (reconciledJobs.length > 0) {
        console.log(`Reconciled ${reconciledJobs.length} stale running jobs after restart.`);
      }
    } else if (taskEngine === 'temporal') {
      const providerlessJobs = await reconcileRestartedProviderlessRunningJobs(pool);
      if (providerlessJobs.length > 0) {
        console.log(`Stopped ${providerlessJobs.length} providerless running Temporal jobs after restart.`);
      }
    }
    const reconciledCreditJobs = await reconcileDbTerminalJobCredits(pool);
    if (reconciledCreditJobs > 0) {
      console.log(`Reconciled ${reconciledCreditJobs} terminal job credit reservations after restart.`);
    }
    if (taskEngine !== 'mysql' && temporalTaskAdapter.configured) {
      temporalWorkerRuntime = await startMeiaoTemporalWorker({
        config: temporalTaskAdapter.config,
        activities: createMysqlTemporalActivities({
          getPool: getMysqlPool,
          executeJob: async (job, signal, options) => {
            const output = await executeApplicationJob(job, process.env, signal, options);
            return persistJobOutputAssetsIfEnabled(job, output);
          },
          getMaxConcurrency: getDbWorkerConcurrency,
          createLog: createDbLog,
          findUserById: findDbUserById,
          settleJobCredits: async ({ job, output, finishedAt, aborted, rejected }) => settleDbJobCredits({ pool, job, output, finishedAt, aborted, rejected }),
          releaseJobCredits: async ({ job, error, finishedAt, retryWaiting }) => releaseDbJobCredits({ pool, job, error, finishedAt, retryWaiting }),
          getProviderlessRunningStaleMs: getTemporalProviderlessRunningStaleMs,
          getSubmittedRunningStaleMs: getTemporalSubmittedRunningStaleMs,
          getCancelledRunningStaleMs: getTemporalCancelledRunningStaleMs,
        }),
        workerOptions: {
          maxConcurrentActivityTaskExecutions: Math.max(1, await getDbWorkerConcurrency()),
        },
      });
      console.log(`Temporal worker listening on task queue ${temporalTaskAdapter.config.taskQueue}.`);
      await runTemporalStaleRunningJobReconcile(pool, 'startup');
      startTemporalStaleRunningJobReconciler(pool);
      const resumedTemporalJobs = await resumePendingDbTemporalJobs(pool);
      if (resumedTemporalJobs > 0) {
        console.log(`Resumed ${resumedTemporalJobs} pending Temporal jobs after restart.`);
      }
    }
    if (taskEngine !== 'temporal') {
      jobWorker = createJobWorker({
        getPool: getMysqlPool,
        executeJob: async (job, signal, options) => {
          const output = await executeApplicationJob(job, process.env, signal, options);
          return persistJobOutputAssetsIfEnabled(job, output);
        },
        getMaxConcurrency: getDbWorkerConcurrency,
        createLog: createDbLog,
        findUserById: findDbUserById,
        settleJobCredits: async ({ job, output, finishedAt, aborted, rejected }) => settleDbJobCredits({ pool, job, output, finishedAt, aborted, rejected }),
        releaseJobCredits: async ({ job, error, finishedAt, retryWaiting }) => releaseDbJobCredits({ pool, job, error, finishedAt, retryWaiting }),
        getTaskEngineMode: () => process.env.MEIAO_TASK_ENGINE,
        getProviderlessRunningStaleMs: getTemporalProviderlessRunningStaleMs,
        getSubmittedRunningStaleMs: getTemporalSubmittedRunningStaleMs,
        getCancelledRunningStaleMs: getTemporalCancelledRunningStaleMs,
      });
      jobWorker.start(1000);
    }
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (MySQL mode, task engine: ${taskEngine})`);
    console.log(`MySQL target: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } else {
    const adminBootstrap = ensureLocalAdminUser(readLocalStore(), {
      createUser,
      persistStore: writeLocalStore,
    });
    if (adminBootstrap.created) {
      console.log(`Local store missing env admin, created user "${adminBootstrap.user.username}".`);
    }
    const taskEngine = normalizeTaskEngineMode(process.env.MEIAO_TASK_ENGINE);
    if (taskEngine !== 'temporal') {
      const reconciledJobs = reconcileLocalStoreJobsAfterRestart();
      if (reconciledJobs.length > 0) {
        console.log(`Reconciled ${reconciledJobs.length} local stale running jobs after restart.`);
      }
    }
    const reconciledCreditJobs = reconcileLocalTerminalJobCreditsAfterRestart();
    if (reconciledCreditJobs > 0) {
      console.log(`Reconciled ${reconciledCreditJobs} local terminal job credit reservations after restart.`);
    }
    if (taskEngine !== 'mysql' && temporalTaskAdapter.configured) {
      temporalWorkerRuntime = await startMeiaoTemporalWorker({
        config: temporalTaskAdapter.config,
        activities: createLocalTemporalActivities({
          readStore: readLocalStore,
          writeStore: writeLocalStore,
          mutateStore: mutateLocalStore,
          executeJob: async (job, signal, options) => {
            const output = await executeApplicationJob(job, process.env, signal, options);
            return persistJobOutputAssetsIfEnabled(job, output);
          },
          createLog: (payload) => mutateLocalStore((store) => {
            appendLocalLog(store, payload);
          }),
          findUserById: (userId) => findLocalUserById(userId),
          settleJobCredits: ({ store, job, output, aborted, rejected }) => settleLocalJobCredits({ store, job, output, aborted, rejected }),
          releaseJobCredits: ({ store, job, error, retryWaiting }) => releaseLocalJobCredits({ store, job, error, retryWaiting }),
        }),
      });
      console.log(`Temporal worker listening on task queue ${temporalTaskAdapter.config.taskQueue}.`);
    }
    if (taskEngine !== 'temporal') {
      localJobWorker = createLocalJobWorker({
        readStore: readLocalStore,
        writeStore: writeLocalStore,
        mutateStore: mutateLocalStore,
        executeJob: async (job, signal, options) => {
          const output = await executeApplicationJob(job, process.env, signal, options);
          return persistJobOutputAssetsIfEnabled(job, output);
        },
        getMaxConcurrency: getLocalWorkerConcurrency,
        createLog: (payload) => mutateLocalStore((store) => {
          appendLocalLog(store, payload);
        }),
        findUserById: (userId) => findLocalUserById(userId),
        settleJobCredits: ({ store, job, output, aborted, rejected }) => settleLocalJobCredits({ store, job, output, aborted, rejected }),
        releaseJobCredits: ({ store, job, error, retryWaiting }) => releaseLocalJobCredits({ store, job, error, retryWaiting }),
      });
      localJobWorker.start(1000);
    }
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (Local JSON mode)`);
  }

  console.log('Default admin bootstrap user:', process.env.MEIAO_ADMIN_USERNAME || 'admin');

  if (!assetCleanupTimer) {
    assetCleanupTimer = setInterval(() => {
      void runManagedAssetCleanupCycle().catch((error) => {
        console.error('asset cleanup failed', error);
      });
    }, ASSET_CLEANUP_INTERVAL_MS);
    void runManagedAssetCleanupCycle().catch((error) => {
      console.error('asset cleanup failed', error);
    });
  }

  if (!managedImageProbeTimer) {
    managedImageProbeTimer = setInterval(() => {
      void runManagedImageUploadProbeCycle().catch((error) => {
        console.error('managed image COS readiness cycle failed', {
          code: String(error?.code || 'probe_cycle_failed').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80),
        });
      });
    }, getManagedImageProbeIntervalMs(process.env));
    void runManagedImageUploadProbeCycle().catch((error) => {
      console.error('managed image COS readiness cycle failed', {
        code: String(error?.code || 'probe_cycle_failed').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80),
      });
    });
  }

  if (shouldUseMysql && !tombstonedJobReconcilerTimer) {
    tombstonedJobReconcilerTimer = setInterval(() => {
      void runTombstonedJobCleanupCycle().catch((error) => {
        console.error('tombstoned job cleanup failed', {
          code: String(error?.code || 'tombstoned_job_cleanup_failed')
            .replace(/[^a-zA-Z0-9_.-]+/g, '_')
            .slice(0, 80),
        });
      });
    }, TOMBSTONED_JOB_RECONCILE_INTERVAL_MS);
    void runTombstonedJobCleanupCycle().catch((error) => {
      console.error('tombstoned job cleanup failed', {
        code: String(error?.code || 'tombstoned_job_cleanup_failed')
          .replace(/[^a-zA-Z0-9_.-]+/g, '_')
          .slice(0, 80),
      });
    });
  }

  if (!logCleanupTimer) {
    logCleanupTimer = setInterval(() => {
      void cleanupExpiredLogs().catch((error) => {
        console.error('log cleanup failed', error);
      });
    }, LOG_CLEANUP_INTERVAL_MS);
    void cleanupExpiredLogs().catch((error) => {
      console.error('log cleanup failed', error);
    });
  }

  await listenAndNotifyReady({ server, port: PORT, host: BIND_HOST });
};

bootstrap().catch((error) => {
  console.error('Server bootstrap failed:', error);
  process.exit(1);
});
