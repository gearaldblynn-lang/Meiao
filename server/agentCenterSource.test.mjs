import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const imagePlanSource = readFileSync(new URL('./agentImagePlan.mjs', import.meta.url), 'utf8');
const checkpointMetadataSource = readFileSync(new URL('./agentChatCheckpointMetadata.mjs', import.meta.url), 'utf8');

test('agent publish flow keeps successful validation as a hard gate', () => {
  assert.match(source, /if \(!targetVersion \|\| targetVersion\.validationStatus !== 'success'\) return null;/);
  assert.match(source, /发布失败，请先完成成功验证。/);
});

test('chat session and message access stay isolated by current user in mysql and local modes', () => {
  assert.match(source, /SELECT \* FROM chat_sessions WHERE id = \? AND user_id = \? LIMIT 1/);
  assert.match(source, /SELECT \* FROM chat_messages WHERE session_id = \? AND user_id = \? ORDER BY created_at ASC/);
  assert.match(source, /\.find\(\(item\) => item\.id === sessionId && item\.userId === user\.id\)/);
  assert.match(source, /\.filter\(\(item\) => item\.sessionId === sessionId && item\.userId === user\.id\)/);
});

test('agent usage visibility for regular admins is scoped by owned agents instead of only their own calls', () => {
  assert.match(source, /LEFT JOIN agents a ON a\.id = l\.agent_id/);
  assert.match(source, /a\.owner_user_id = \?/);
  assert.match(source, /const manageableAgentIds = new Set\(listLocalAgents\(store, admin\)\.map\(\(item\) => item\.id\)\);/);
  assert.match(source, /isSuperAdminUser\(admin\) \|\| manageableAgentIds\.has\(item\.agentId\)/);
  assert.doesNotMatch(source, /const where = isSuperAdminUser\(user\) \? '' : 'WHERE user_id = \?';/);
});

test('agent center supports hard deletion for agents and non-published versions', () => {
  assert.match(source, /const deleteDbAgent = async/);
  assert.match(source, /const deleteDbAgentVersion = async/);
  assert.match(source, /if \(agentDetailMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /if \(agentVersionDetailMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /永久删除/);
  assert.match(source, /version\.isPublished/);
});

test('agent center persists agent icon fields for preset and uploaded avatars', () => {
  assert.match(source, /icon_url VARCHAR\(1024\) NULL/);
  assert.match(source, /avatar_preset VARCHAR\(40\) NULL/);
  assert.match(source, /iconUrl:/);
  assert.match(source, /avatarPreset:/);
  assert.match(source, /INSERT INTO agents \(id, name, description, department, owner_user_id, visibility_scope, status, current_version_id, icon_url, avatar_preset, created_at, updated_at\)/);
});

test('agent center persists editable version names in mysql and local modes', () => {
  assert.match(source, /version_name VARCHAR\(160\) NOT NULL/);
  assert.match(source, /const ensureMysqlColumn = async \(pool, tableName, columnName, definition\) =>/);
  assert.match(source, /SHOW COLUMNS FROM/);
  assert.match(source, /ADD COLUMN/);
  assert.match(source, /versionName:/);
  assert.match(source, /payload\.versionName/);
});

test('agent chat source persists user avatars, chat session options, and model restrictions', () => {
  assert.match(source, /avatar_url VARCHAR\(1024\) NULL/);
  assert.match(source, /ensureMysqlColumn\(pool, 'users', 'avatar_url', 'VARCHAR\(1024\) NULL'\)/);
  assert.match(source, /selected_model VARCHAR\(80\) NOT NULL/);
  assert.match(source, /reasoning_level VARCHAR\(40\) NULL/);
  assert.match(source, /web_search_enabled TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(source, /allowed_chat_models_json LONGTEXT NULL/);
  assert.match(source, /default_chat_model VARCHAR\(80\) NULL/);
});

test('system announcement source stays in global settings for mysql and local modes', () => {
  assert.match(source, /const normalizeSystemAnnouncement = \(value = \{\}\) =>/);
  assert.match(source, /announcement: normalizeSystemAnnouncement/);
  assert.match(source, /const mergeSystemAnnouncementUpdate = \(currentSettings = \{\}, bodyAnnouncement = undefined, admin = null\) =>/);
  assert.match(source, /announcement: mergeSystemAnnouncementUpdate\(currentSettings, body\?\.announcement, admin\)/);
  assert.match(source, /announcement: mergeSystemAnnouncementUpdate\(currentLocalSettings, body\?\.announcement, admin\)/);
  assert.match(source, /analysisModel: body\?\.analysisModel \?\? currentSettings\.analysisModel/);
  assert.match(source, /videoAnalysisModel: body\?\.videoAnalysisModel \?\? currentSettings\.videoAnalysisModel/);
  assert.match(source, /const currentLocalSettings = getLocalSystemSettings\(store\)/);
  assert.match(source, /analysisModel: body\?\.analysisModel \?\? currentLocalSettings\.analysisModel/);
  assert.match(source, /videoAnalysisModel: body\?\.videoAnalysisModel \?\? currentLocalSettings\.videoAnalysisModel/);
});

test('agent version source persists knowledge document bindings in mysql and local modes', () => {
  assert.match(source, /knowledge_document_bindings_json LONGTEXT NULL/);
  assert.match(source, /ensureMysqlColumn\(pool, 'agent_versions', 'knowledge_document_bindings_json', 'LONGTEXT NULL'\)/);
  assert.match(source, /knowledgeDocumentBindings:/);
  assert.match(source, /payload\.knowledgeDocumentBindings/);
});

test('agent retrieval source filters chunks by enabled knowledge document ids', () => {
  assert.match(source, /const resolveEnabledKnowledgeDocumentIds = \(version, knowledgeBaseId, availableDocumentIds = \[\]\) =>/);
  assert.match(source, /if \(!binding\) return new Set\(availableDocumentIds\);/);
  assert.match(source, /AND kc\.document_id IN/);
  assert.match(source, /enabledDocumentIds\.has\(chunk\.documentId\)/);
});

test('知识文档分块写入时填充 embedding（两种 mode + 失败降级 null）', () => {
  assert.match(source, /import \{ embedTexts \} from '\.\/embeddingProvider\.mjs'/);
  assert.match(source, /const embedChunkContentsSafe = async \(contents\) =>/);
  assert.match(source, /embedTexts\(/);
  assert.match(source, /chunkEmbeddings/);
  assert.match(source, /chunkEmbeddings\[index\] \? JSON\.stringify\(chunkEmbeddings\[index\]\) : null/);
  assert.match(source, /embedding: chunkEmbeddings\[index\] \|\| null/);
  assert.match(source, /chunk embedding 失败/);
});

test('知识库检索接入向量并保持 MySQL/本地双 handler 同步', () => {
  assert.match(source, /import \{ searchKnowledgeChunksByVector \} from '\.\/ragRetrieval\.mjs'/);
  assert.match(source, /embedding: parseJsonField\(row\.embedding_json, null\)/);
  const calls = Array.from(source.matchAll(/await searchKnowledgeChunksByVector\(/g));
  assert.ok(calls.length >= 4);
  assert.doesNotMatch(source, /= searchKnowledgeChunks\(/);
});

test('V2 接入 responses provider 并注入知识库/联网工具(双 handler)', () => {
  assert.match(source, /openai_responses/);
  const hasKnowledgeBase = Array.from(source.matchAll(/hasKnowledgeBase:/g));
  assert.ok(hasKnowledgeBase.length >= 2, 'MySQL+本地双 handler 都要传 hasKnowledgeBase');
  const searchKnowledge = Array.from(source.matchAll(/searchKnowledge:/g));
  assert.ok(searchKnowledge.length >= 2, '双 handler 都要注入 searchKnowledge');
  const webSearchEnabled = Array.from(source.matchAll(/webSearchEnabled: Boolean\(/g));
  assert.ok(webSearchEnabled.length >= 2, '双 handler 都要透传 webSearchEnabled');
  const reasoningPayloads = Array.from(source.matchAll(/taskType: 'openai_responses',[\s\S]*?reasoningLevel:/g));
  assert.ok(reasoningPayloads.length >= 2, '双 handler 的 responses payload 都要透传 reasoningLevel');
});

test('agent V2 prepares managed image URLs as provider-stable HTTPS URLs before model vision analysis', () => {
  assert.match(source, /import \{ resolveProviderChatMediaUrl as resolveProviderChatMediaUrlForModel \} from '\.\/providerAssetTransfer\.mjs'/);
  assert.match(source, /import \{ executeProviderJob, uploadAssetViaKieStream \} from '\.\/providerGateway\.mjs'/);
  assert.match(source, /const prepareAgentModelImageUrl = async \(url\) =>/);
  assert.match(source, /resolveProviderChatMediaUrlForModel\(url, \{\s*env: process\.env,\s*deps: \{ uploadAssetViaKieStream \},\s*\}\)/);
  const prepareHooks = Array.from(source.matchAll(/prepareModelImageUrl: prepareAgentModelImageUrl/g));
  assert.ok(prepareHooks.length >= 2, 'MySQL+本地 V2 chat handler 都要准备模型可读图片 URL');
});

test('agent chat streaming is wired through both mysql and local handlers without duplicate final deltas', () => {
  assert.match(source, /let chatStreamHadDelta = false;/);
  assert.match(source, /if \(normalizedType === 'streaming' && payload\?\.delta\) chatStreamHadDelta = true;/);
  assert.match(source, /if \(!chatStreamHadDelta\) sendChatEvent\('streaming', \{ delta: result\.assistantMessage\?\.content \|\| '' \}\);/);
  assert.match(source, /const localWantsStream = String\(req\.headers\.accept \|\| ''\)\.includes\('text\/event-stream'\) \|\| body\?\.stream === true;/);
  assert.match(source, /const sendLocalChatEvent = localWantsStream/);
  assert.match(source, /if \(sendLocalChatEvent\) sendLocalChatEvent\('streaming', \{ delta \}\);/);
  assert.match(source, /if \(!localStreamHadDelta\) sendLocalChatEvent\('streaming', \{ delta: response\.body\.assistantMessage\?\.content \|\| '' \}\);/);
});

test('agent chat source exposes current-user profile updates and session patch delete routes', () => {
  assert.match(source, /if \(url\.pathname === '\/api\/auth\/me' && req\.method === 'PATCH'\)/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'PATCH'\)/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /if \(chatAgentHistoryMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /deleteDbChatSession/);
  assert.match(source, /deleteDbUserAgentHistory/);
  assert.match(source, /createDbChatSessionOptions/);
});

test('agent chat session deletion cascades managed assets in mysql and local modes', () => {
  assert.match(source, /collectStoredAssetIdsFromValue/);
  assert.match(source, /const collectStoredAssetIdsFromChatMessages = \(messages = \[\]\) =>/);
  assert.match(source, /const deleteStoredAssetsByIdsForUser = async \(\{ user, assetIds \}\) =>/);
  assert.match(source, /SELECT \* FROM chat_messages WHERE session_id = \? AND user_id = \?/);
  assert.match(source, /SELECT \* FROM chat_messages WHERE user_id = \? AND session_id IN/);
  assert.match(source, /const assetIds = collectStoredAssetIdsFromChatMessages\(messages\);/);
  assert.match(source, /await deleteStoredAssetsByIdsForUser\(\{ user, assetIds \}\)/);
  assert.match(source, /const deletedAssetIds = collectStoredAssetIdsFromChatMessages\(sessionMessages\);/);
  assert.match(source, /await deleteStoredAssetsByIdsForUser\(\{ user, assetIds: deletedAssetIds \}\)/);
  assert.match(source, /const historyAssetIds = collectStoredAssetIdsFromChatMessages\(historyMessages\);/);
  assert.match(source, /await deleteStoredAssetsByIdsForUser\(\{ user, assetIds: historyAssetIds \}\)/);
});

test('agent chat source validates model ability before accepting attachments or web search', () => {
  assert.match(source, /getChatModelCapability/);
  assert.match(source, /getAttachmentCapabilityError/);
  assert.match(source, /supportsImageInput/);
  assert.match(source, /supportsFileInput/);
  assert.match(source, /supportsWebSearch/);
  assert.match(source, /当前环境下不支持图片输入/);
  assert.match(source, /当前环境下不支持文件输入/);
  assert.match(source, /当前模型不支持联网/);
});

test('agent chat source expands legacy default model allowlists to include newly added claude', () => {
  assert.match(source, /const LEGACY_DEFAULT_ALLOWED_CHAT_MODELS = new Set\(\['gpt-5-4-openai-resp', 'gemini-3-flash-openai'\]\);/);
  assert.match(source, /const EXPANDED_LEGACY_CHAT_MODELS = \['claude-sonnet-4-6'\];/);
  assert.match(source, /return expandLegacyAllowedChatModels\(sanitizeAllowedChatModels\(configured,/);
});

test('agent chat source gives fully expired legacy model configs a usable fallback pair', () => {
  assert.match(source, /const DEFAULT_RECOVERY_ALLOWED_CHAT_MODELS = \['gpt-5-4-openai-resp', 'gemini-3-flash-openai'\];/);
  assert.match(source, /const configuredRelayModels = catalog[\s\S]*?\.filter\(\(item\) => item\.provider === 'openai_compatible'\)[\s\S]*?\.map\(\(item\) => item\.id\);/);
  assert.match(source, /const recoveryModels = \[\.\.\.configuredRelayModels, \.\.\.DEFAULT_RECOVERY_ALLOWED_CHAT_MODELS\]/);
  assert.match(source, /if \(recoveryModels\.length > 0\) return recoveryModels;/);
});

test('agent chat source preserves provider modelUsed metadata for direct conversations', () => {
  assert.match(source, /let output = null;[\s\S]*output = await executeProviderJobWithManagedAssetScrub\(\{[\s\S]*model: selectedModel,[\s\S]*const actualModel = String\(output\?\.result\?\.modelUsed \|\| selectedModel/);
});

test('agent retrieval loop forwards configured chat fallback models to provider execution', () => {
  assert.match(source, /const runAgenticRetrievalLoop = async \(\{[\s\S]*fallbackModels = \[\],[\s\S]*\}\) =>/);
  assert.match(source, /payload: \{ messages, model: selectedModel, fallbackModels, reasoningLevel, webSearchEnabled \}/);
  assert.match(source, /runAgenticRetrievalLoop\(\{[\s\S]*selectedModel,[\s\S]*fallbackModels,[\s\S]*candidateChunks/);
});

test('agent chat source forwards multimodal attachments and model options into provider execution in both modes', () => {
  assert.match(source, /const buildChatMessageContent = \(text, attachments = \[\]\) =>/);
  assert.match(source, /type: 'image_url'/);
  assert.match(source, /type: 'input_file'/);
  assert.match(source, /const runAgentConversation = async \([\s\S]*?const pool = await getMysqlPool\(\);[\s\S]*?const \{ text: inlinedMessage, attachments: remainingAttachments \} = await inlineTextAttachments\(pool, currentMessage, attachments\)/);
  assert.match(source, /const \{ text: inlinedMessage, attachments: remainingAttachments \} = await inlineTextAttachments\(pool, currentMessage, attachments\)/);
  assert.match(source, /content: buildChatMessageContent\(inlinedMessage, remainingAttachments\)/);
  assert.match(source, /reasoningLevel: reasoningLevel \? String\(reasoningLevel\) : null/);
  assert.match(source, /webSearchEnabled: Boolean\(webSearchEnabled\)/);
  assert.match(source, /attachments,\s+reasoningLevel: payload\?\.reasoningLevel \|\| null,\s+webSearchEnabled: Boolean\(payload\?\.webSearchEnabled\)/);
  assert.match(source, /attachments,\s+reasoningLevel: body\?\.reasoningLevel \|\| null,\s+webSearchEnabled: Boolean\(body\?\.webSearchEnabled\)/);
});

test('agent chat source persists image-mode session preference in mysql and local modes', () => {
  assert.match(source, /last_image_mode TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(source, /ensureMysqlColumn\(pool, 'chat_sessions', 'last_image_mode', 'TINYINT\(1\) NOT NULL DEFAULT 0'\)/);
  assert.match(source, /lastImageMode: Boolean\(row\.last_image_mode\)/);
  assert.match(source, /lastImageMode: Boolean\(rows\[0\]\.last_image_mode\)/);
  assert.match(source, /lastImageMode: false,/);
  assert.match(source, /session\.lastImageMode = Boolean\(body\?\.lastImageMode\)/);
  assert.match(source, /UPDATE chat_sessions SET selected_model = \?, reasoning_level = \?, web_search_enabled = \?, last_image_mode = \?, updated_at = \? WHERE id = \? AND user_id = \?/);
});

test('agent chat source records image generation usage and local image replies', () => {
  assert.match(source, /result\?\.requestType \|\| \(result\?\.sessionId \? 'chat' : 'validation'\)/);
  assert.match(source, /result\?\.requestType === 'image_generation' \? 'create_image_task' : result\?\.sessionId \? 'agent_chat' : 'agent_validate'/);
  assert.match(source, /const requestMode = body\?\.requestMode === 'image_generation' \? 'image_generation' : 'chat';/);
  assert.match(source, /if \(requestMode === 'image_generation' && attachments\.some\(\(item\) => item\.kind !== 'image'\)\)/);
  assert.match(source, /result = requestMode === 'image_generation'/);
  assert.match(source, /buildImageConversationResult\(/);
  assert.match(source, /imageCapability\.defaultSize \|\| 'auto'/);
  assert.match(source, /const hasExplicitAspectRatioInstruction = detectExplicitAspectRatioInstruction\(currentMessage\);/);
  assert.match(source, /const shouldKeepAutoAspectRatio = !hasExplicitAspectRatioInstruction && !hasAspectRatioCorrectionIntent\(currentMessage\);/);
  assert.match(source, /const normalizedAspectRatio = shouldKeepAutoAspectRatio/);
  assert.match(source, /const normalizedResolution = String\(imageCapability\.defaultResolution \|\| '1K'\)\.trim\(\) \|\| '1K';/);
  assert.match(source, /requestType: result\.requestType \|\| requestMode/);
  assert.match(source, /action: requestMode === 'image_generation' \? 'create_image_task' : 'agent_chat'/);
  assert.match(source, /imagePlan: result\.imagePlan \|\| latestDbChatProviderTaskCheckpoint\?\.imagePlan \|\| null/);
  assert.match(source, /imagePlan: result\.imagePlan \|\| latestLocalChatProviderTaskCheckpoint\?\.imagePlan \|\| null/);
  assert.match(source, /imageResultUrls: result\.imageResultUrls \|\| null/);
});

test('agent image chats checkpoint generated assets before final reply persistence', () => {
  assert.match(source, /const buildAgentImageResultAttachments = \(imageResultUrls\) =>/);
  assert.match(source, /buildReadyImageCheckpoint/);
  assert.match(source, /const persistDbChatImageCheckpoint = async \(checkpointResult = \{\}\) =>/);
  assert.match(source, /const checkpoint = buildReadyImageCheckpoint\(\{/);
  assert.match(checkpointMetadataSource, /checkpoint: 'image_result_ready'/);
  assert.match(source, /onImageReady: persistDbChatImageCheckpoint/);
  assert.match(source, /const persistLocalChatImageCheckpoint = async \(checkpointResult = \{\}\) =>/);
  assert.match(source, /onImageReady: persistLocalChatImageCheckpoint/);
  assert.match(source, /await persistDbChatImageCheckpoint\(\{[\s\S]*?requestMode: 'tool_calling'[\s\S]*?imageResultUrls: \[imageUrl\]/);
  assert.match(source, /await persistLocalChatImageCheckpoint\(\{[\s\S]*?requestMode: 'tool_calling'[\s\S]*?imageResultUrls: \[imageUrl\]/);
  assert.match(source, /if \(typeof onImageReady === 'function' && result\.imageResultUrls\.length > 0\) \{[\s\S]*?await onImageReady\(result\);/);
});

test('agent tool-calling image chats checkpoint provider task ids immediately after submission', () => {
  assert.match(source, /buildSubmittedImageTaskCheckpoint/);
  assert.match(source, /const persistDbChatProviderTaskCheckpoint = async \(checkpointResult = \{\}\) =>/);
  assert.match(source, /const checkpoint = buildSubmittedImageTaskCheckpoint\(\{/);
  assert.match(checkpointMetadataSource, /checkpoint: 'image_task_submitted'/);
  assert.match(source, /const persistLocalChatProviderTaskCheckpoint = async \(checkpointResult = \{\}\) =>/);
  assert.match(source, /onProviderTaskId: async \(providerTaskId\) => \{[\s\S]*?await persistDbChatProviderTaskCheckpoint\(\{/);
  assert.match(source, /onProviderTaskId: async \(providerTaskId\) => \{[\s\S]*?await persistLocalChatProviderTaskCheckpoint\(\{/);
  assert.match(source, /imagePlan: \{[\s\S]*?requestMode: 'tool_calling'[\s\S]*?providerTaskId,[\s\S]*?\}/);
});

test('agent chat message listing auto-recovers submitted provider image tasks', () => {
  assert.match(source, /const recoverDbSubmittedChatImageTasks = async \(user, sessionId, messages = \[\]\) =>/);
  assert.match(source, /const recoverLocalSubmittedChatImageTasks = async \(store, user, sessionId, messages = \[\]\) =>/);
  assert.match(source, /taskType: 'kie_probe'/);
  assert.match(source, /checkpoint: 'image_task_recovered'/);
  assert.match(source, /await recoverDbSubmittedChatImageTasks\(user, sessionId, messages\)/);
  assert.match(source, /await recoverLocalSubmittedChatImageTasks\(store, user, sessionId, messages\)/);
});

test('agent image result asset persistence bounds provider task ids before writing stored asset job id', () => {
  assert.match(source, /const normalizeStoredAssetJobId = \(value\) => String\(value \|\| ''\)\.trim\(\)\.slice\(0, 120\);/);
  assert.match(source, /jobId: normalizeStoredAssetJobId\(imageOutput\?\.providerTaskId\)/);
});

test('agent chat source persists client request ids so timed-out image chats can sync completed results', () => {
  assert.match(source, /const clientRequestId = String\(payload\?\.clientRequestId \|\| createEntityId\(\)\)\.trim\(\) \|\| createEntityId\(\);/);
  assert.match(source, /const clientRequestId = String\(body\?\.clientRequestId \|\| createEntityId\(\)\)\.trim\(\) \|\| createEntityId\(\);/);
  assert.match(source, /clientRequestId,/);
  assert.match(source, /const userMetadata = \{[\s\S]*?selectedModel,[\s\S]*?reasoningLevel: payload\?\.reasoningLevel \|\| null,[\s\S]*?webSearchEnabled: Boolean\(payload\?\.webSearchEnabled\),[\s\S]*?requestMode,[\s\S]*?clientRequestId,[\s\S]*?runId,[\s\S]*?contextTrace,[\s\S]*?\};/);
  assert.match(source, /const assistantMetadata = \{[\s\S]*?selectedModel: result\.selectedModel,[\s\S]*?fallbackFrom: result\.fallbackFrom \|\| null,[\s\S]*?usedRetrieval: result\.usedRetrieval,[\s\S]*?reasoningLevel: payload\?\.reasoningLevel \|\| null,[\s\S]*?webSearchEnabled: Boolean\(payload\?\.webSearchEnabled\),[\s\S]*?requestMode,[\s\S]*?clientRequestId,[\s\S]*?runId,[\s\S]*?imagePlan: result\.imagePlan \|\| latestDbChatProviderTaskCheckpoint\?\.imagePlan \|\| null,[\s\S]*?imageResultUrls: result\.imageResultUrls \|\| null,[\s\S]*?retrievalSummary: result\.retrievalSummary \|\| \[\][\s\S]*?\};/);
  assert.match(source, /metadata: userMetadata/);
  assert.match(source, /metadata: assistantMetadata/);
});

test('agent chat source writes detailed runtime logs for both success and failure paths', () => {
  assert.match(source, /const buildAgentRuntimeLogMeta = \(\{ agent, version, result = null, requestMode = '', sessionId = null, clientRequestId = '', error = null \}\) => \(\{/);
  assert.match(source, /sessionId: result\?\.sessionId \|\| sessionId \|\| null/);
  assert.match(source, /clientRequestId: result\?\.clientRequestId \|\| clientRequestId \|\| null/);
  assert.match(source, /imageResultCount: Array\.isArray\(result\?\.imageResultUrls\) \? result\.imageResultUrls\.length : 0/);
  assert.match(source, /providerTaskId: result\?\.providerTaskId \|\| error\?\.providerTaskId \|\| ''/);
  assert.match(source, /providerStage: result\?\.providerStage \|\| error\?\.providerStage \|\| ''/);
  assert.match(source, /providerStatus: result\?\.providerStatus \|\| error\?\.providerStatus \|\| ''/);
  assert.match(source, /providerMessage: result\?\.providerMessage \|\| error\?\.providerMessage \|\| ''/);
  assert.match(source, /inputImageCount: Number\(result\?\.imagePlan\?\.inputImageUrls\?\.length \|\| error\?\.inputImageCount \|\| 0\)/);
  assert.match(source, /inputImageUrls: result\?\.imagePlan\?\.inputImageUrls \|\| error\?\.inputImageUrls \|\| \[\]/);
  assert.match(source, /usedImageReferenceUrls: result\?\.imagePlan\?\.imageReferences\?\.map\?\.\(\(item\) => item\?\.url\)\.filter\(Boolean\) \|\| error\?\.usedImageReferenceUrls \|\| \[\]/);
  assert.match(source, /retrievalSummary: result\?\.retrievalSummary \|\| \[\]/);
  assert.match(source, /imagePlan: result\?\.imagePlan \|\| null/);
  assert.match(source, /errorCode: result\?\.errorCode \|\| error\?\.code \|\| ''/);
  assert.match(source, /await createDbLog\(\{/);
  assert.match(source, /status: 'failed'/);
  assert.match(source, /message: `\$\{requestMode === 'image_generation' \? '智能体生图失败' : '智能体对话失败'\}：\$\{agent\.name\}`/);
  assert.match(source, /detail: error\?\.message \|\| '聊天回复失败。'/);
  assert.match(source, /errorMessage: error\?\.message \|\| ''/);
});

test('agent image conversation prompt includes deterministic image order mapping with urls and falls back to image model on failures', () => {
  assert.match(imagePlanSource, /export const normalizeAgentImageUrl = \(value\) =>/);
  assert.match(imagePlanSource, /const markdownTarget = raw\.match/);
  assert.match(imagePlanSource, /export const resolveAgentImagePlanInputUrlDetails = \(\{/);
  assert.match(imagePlanSource, /recovered_selected_references_from_unusable_analysis_input/);
  assert.match(imagePlanSource, /export const shouldRequireAgentImageInput = \(\{/);
  assert.match(source, /改图任务没有可用输入图，已停止提交，避免被生图模型当作文生图执行。/);
  assert.match(source, /结构化字段是后端提交生图的唯一依据/);
  assert.match(imagePlanSource, /analysisReturnedEmptyInput/);
  assert.match(imagePlanSource, /analysisReturnedUnusableInput/);
  assert.match(imagePlanSource, /shouldRecoverSelectedReferences/);
  assert.match(source, /const url = normalizeAgentImageUrl\(item\?\.url\);/);
  assert.match(source, /message\.metadata\.imageResultUrls\.map\(\(item\) => normalizeAgentImageUrl\(item\)\)\.filter\(Boolean\)/);
  assert.match(imagePlanSource, /\.map\(\(item\) => normalizeAgentImageUrl\(item\)\)/);
  assert.match(source, /const buildImagePromptReferenceText = \(imageReferences = \[\], preferredInputImageUrls = \[\]\) =>/);
  assert.match(source, /const extractExplicitImageReferenceIndexes = \(text = ''\) =>/);
  assert.match(source, /const extractDirectionalImageReferenceIndexes = \(\{ text = '', imageReferences = \[\] \}\) =>/);
  assert.match(source, /const selectRelevantImageReferences = \(\{ imageReferences = \[\], userMessage = '', maxInputImages = 1, editPreferenceHints = null \}\) =>/);
  assert.match(source, /const explicitIndexes = extractExplicitImageReferenceIndexes\(userMessage\);/);
  assert.match(source, /const directionalIndexes = extractDirectionalImageReferenceIndexes\(\{ text: userMessage, imageReferences: refs \}\);/);
  assert.match(source, /const requestedIndexes = Array\.from\(new Set\(\[\.\.\.explicitIndexes, \.\.\.directionalIndexes\]\)\);/);
  assert.match(source, /const currentUploadMatches = Array\.from\(String\(text \|\| ''\)\.matchAll\(/);
  assert.match(source, /const previousResultMatches = Array\.from\(String\(text \|\| ''\)\.matchAll\(/);
  assert.match(source, /if \(\/上一张|上一版|最近一张|刚才那张|刚才那版|上次生成|上一张生成图\/\.test\(normalizedText\)\)/);
  assert.match(source, /const fallbackCandidates = editPreferenceHints\?\.preferPreviousResultAsPrimary/);
  assert.match(source, /historyAttachments\.slice\(-1\)/);
  assert.match(source, /fallbackCandidates\.forEach\(\(item\) => pushReference\(item\)\);/);
  assert.match(source, /const relevantImageReferences = selectRelevantImageReferences\(\{/);
  assert.match(source, /imageReferences,\s+userMessage: currentMessage,\s+maxInputImages: Number\(imageCapability.maxInputImages \|\| 1\),\s+editPreferenceHints,/);
  assert.match(source, /const normalizedRefs = relevantImageReferences\.map\(\(item\) => \(\{/);
  assert.match(source, /const usedImageReferences = preferredInputImageUrls\.map\(\(url\) => \{/);
  assert.match(source, /normalizeAgentImageUrl\(item\.url\) === normalizedUrl/);
  assert.match(source, /输入图顺序说明（必须严格按下列顺序理解）/);
  assert.match(source, /图\$\{index \+ 1\}：URL=\$\{url\}/);
  assert.match(source, /const promptReferenceText = buildImagePromptReferenceText\(normalizedRefs, preferredInputImageUrls\);/);
  assert.match(source, /const finalPrompt = `\$\{promptPrefix\}\$\{promptReferenceText\}\\n\$\{String\(parsed\.prompt \|\| currentMessage\)\.trim\(\)\}`\.trim\(\);/);
  assert.match(source, /imageReferences: usedImageReferences,/);
  assert.match(source, /requestMode === 'image_generation' \? version\?\.modelPolicy\?\.multimodalModel : version\?\.modelPolicy\?\.defaultModel/);
});

test('agent studio source exposes draft-only training and testing endpoints in mysql and local modes', () => {
  assert.match(source, /const STUDIO_CONFIG_ASSISTANT_PROMPT = \(\{ agentName, systemPrompt, knowledgeNames, manageableKnowledgeBases, manageableKnowledgeDocuments \}\) =>/);
  assert.match(source, /R Role 角色/);
  assert.match(source, /T Task 任务/);
  assert.match(source, /C Constraint 约束/);
  assert.match(source, /F Format 格式/);
  assert.match(source, /E Example 示例/);
  assert.match(source, /const parseConfigChanges = \(text\) =>/);
  assert.match(source, /const handleStudioTrainingMessage = async \(user, versionId, payload\) =>/);
  assert.match(source, /const applyStudioTrainingChanges = async \(user, versionId, payload\) =>/);
  assert.match(source, /const createStudioTestSession = async \(user, payload\) =>/);
  assert.match(source, /const studioTrainingMatch = url\.pathname\.match\(/);
  assert.match(source, /const studioTrainingApplyMatch = url\.pathname\.match\(/);
  assert.match(source, /if \(studioTrainingApplyMatch && req\.method === 'POST'\)/);
  assert.match(source, /url\.pathname === '\/api\/studio\/test\/sessions' && req\.method === 'POST'/);
  assert.match(source, /工作室测试/);
  assert.match(source, /if \(!agent \|\| !canManageOwnedResource\(admin, agent\.ownerUserId\)\)/);
  assert.match(source, /if \(!agent \|\| !version \|\| version\.agentId !== agentId \|\| version\.isPublished \|\| !canManageOwnedResource\(admin, agent\.ownerUserId\)\)/);
  assert.match(source, /- knowledgeDocument：新增、修改或删除知识库文档/);
  assert.match(source, /- knowledgeBaseIds：调整当前智能体绑定的知识库/);
  assert.match(source, /- openingRemarks：更新开场白/);
  assert.match(source, /- modelPolicy：调整默认模型、简单问题模型、高级模型、多模态模型或生图开关/);
  assert.match(source, /- retrievalPolicy：调整检索开关、参考数量、片段上限、上下文上限等策略/);
  assert.match(source, /建议阶段不要直接宣称“我已经修改完成”/);
});

test('agent studio training source forwards unified composer attachments and model options into provider execution', () => {
  assert.match(source, /const attachments = Array\.isArray\(payload\?\.attachments\) \? payload\.attachments : \[\];/);
  assert.match(source, /const selectedModel = resolveChatSessionModel\(version, payload\?\.selectedModel \|\| version\.defaultChatModel \|\| version\.modelPolicy\?\.defaultModel \|\| ''\);/);
  assert.match(source, /const capabilityError = getAttachmentCapabilityError\(\{ capability, attachments, requestMode: 'chat', modelLabel: `模型 \$\{selectedModel\} ` \}\);/);
  assert.match(source, /if \(payload\?\.webSearchEnabled && !capability\?\.supportsWebSearch\) \{/);
  assert.match(source, /attachments,\s+selectedModelOverride: selectedModel,\s+reasoningLevel: payload\?\.reasoningLevel \|\| null,\s+webSearchEnabled: Boolean\(payload\?\.webSearchEnabled\)/);
  assert.match(source, /let attachments = \[\];/);
  assert.match(source, /attachments = Array\.isArray\(body\?\.attachments\) \? body\.attachments : \[\];/);
  assert.match(source, /selectedModel = resolveChatSessionModel\(version, body\?\.selectedModel \|\| version\.defaultChatModel \|\| version\.modelPolicy\?\.defaultModel \|\| ''\);/);
  assert.match(source, /const capabilityError = getAttachmentCapabilityError\(\{ capability, attachments, requestMode: 'chat', modelLabel: `模型 \$\{selectedModel\} ` \}\);/);
  assert.match(source, /if \(body\?\.webSearchEnabled && !capability\?\.supportsWebSearch\) \{/);
  assert.match(source, /attachments,\s+selectedModelOverride: selectedModel,\s+reasoningLevel: body\?\.reasoningLevel \|\| null,\s+webSearchEnabled: Boolean\(body\?\.webSearchEnabled\)/);
  assert.match(source, /const result = await runLocalAgentConversation\(\{/);
  assert.match(source, /appendLocalLog\(store, \{/);
  assert.match(source, /message: `工作室训练失败：\$\{agentName\}`/);
  assert.match(source, /selectedModel,/);
  assert.match(source, /attachmentKinds: attachments\.map\(\(item\) => item\?\.kind === 'image' \? 'image' : 'file'\)/);
  assert.match(source, /providerStage: error\?\.providerStage \|\| ''/);
  assert.match(source, /providerStatus: error\?\.providerStatus \|\| ''/);
});

test('agent studio training source accepts and applies opening remarks changes', () => {
  assert.match(source, /const field = \['systemPrompt', 'openingRemarks', 'knowledgeDocument', 'modelPolicy', 'retrievalPolicy', 'knowledgeBaseIds'\]/);
  assert.match(source, /if \(field === 'openingRemarks' && !Object\.prototype\.hasOwnProperty\.call\(input, 'after'\)\) return null;/);
  assert.match(source, /if \(change\.field === 'openingRemarks'\) \{\s*return \{ openingRemarks: change\.after \|\| null \};\s*\}/);
});

test('local studio upload source keeps localhost managed asset persistence enabled in local json mode', () => {
  assert.match(source, /const getPersistentAssetBaseUrl = \(req = null\) => \{/);
  assert.match(source, /if \(!inferred\) return '';/);
  assert.match(source, /if \(!shouldUseMysql\) return inferred;/);
  assert.match(source, /if \(isLocalHostValue\(inferred\)\) return '';/);
});

test('managed asset uploads do not fall back to third-party auth just because public base url is empty', () => {
  assert.match(source, /const persistUploadedAssetIfEnabled = async \(\{ req, user, moduleName, fileName, mimeType, fileBuffer, width = 0, height = 0 \}\) => \{/);
  assert.doesNotMatch(
    source,
    /const persistUploadedAssetIfEnabled = async \(\{ req, user, moduleName, fileName, mimeType, fileBuffer, width = 0, height = 0 \}\) => \{\s+const publicBaseUrl = getPersistentAssetBaseUrl\(req\);\s+if \(!publicBaseUrl\) \{\s+return null;\s+\}/
  );
});

test('cloud output asset persistence also rewrites generated image arrays and direct image chat results to managed urls', () => {
  assert.match(source, /const persistRuntimeRemoteAssetIfEnabled = async \(\{ userId, moduleName, assetType = 'result', remoteUrl, originalName = 'result\.png', provider = 'kie', jobId = '' \}\) => \{/);
  assert.match(source, /const persistRemoteArrayField = async \(fieldName, assetType, fallbackNameBuilder\) => \{/);
  assert.match(source, /await persistRemoteArrayField\('imageResultUrls', 'result'/);
  assert.match(source, /await persistRemoteArrayField\('resultUrls', 'result'/);
  assert.match(source, /const persistedImageUrl = await persistRuntimeRemoteAssetIfEnabled\(\{/);
  assert.match(source, /imageResultUrls: persistedImageUrl \? \[persistedImageUrl\] : \[\],/);
});
