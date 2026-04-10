import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

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

test('agent chat source exposes current-user profile updates and session patch delete routes', () => {
  assert.match(source, /if \(url\.pathname === '\/api\/auth\/me' && req\.method === 'PATCH'\)/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'PATCH'\)/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /if \(chatAgentHistoryMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /deleteDbChatSession/);
  assert.match(source, /deleteDbUserAgentHistory/);
  assert.match(source, /createDbChatSessionOptions/);
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

test('agent chat source forwards multimodal attachments and model options into provider execution in both modes', () => {
  assert.match(source, /const buildChatMessageContent = \(text, attachments = \[\]\) =>/);
  assert.match(source, /type: 'image_url'/);
  assert.match(source, /type: 'input_file'/);
  assert.match(source, /content: buildChatMessageContent\(currentMessage, attachments\)/);
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
  assert.match(source, /const result = requestMode === 'image_generation'/);
  assert.match(source, /buildImageConversationResult\(/);
  assert.match(source, /imageCapability\.defaultSize \|\| 'auto'/);
  assert.match(source, /const hasExplicitAspectRatioInstruction = detectExplicitAspectRatioInstruction\(currentMessage\);/);
  assert.match(source, /const shouldKeepAutoAspectRatio = !hasExplicitAspectRatioInstruction && !hasAspectRatioCorrectionIntent\(currentMessage\);/);
  assert.match(source, /const normalizedAspectRatio = shouldKeepAutoAspectRatio/);
  assert.match(source, /const normalizedResolution = String\(imageCapability\.defaultResolution \|\| '1K'\)\.trim\(\) \|\| '1K';/);
  assert.match(source, /requestType: result\.requestType \|\| requestMode/);
  assert.match(source, /action: requestMode === 'image_generation' \? 'create_image_task' : 'agent_chat'/);
  assert.match(source, /imagePlan: result\.imagePlan \|\| null/);
  assert.match(source, /imageResultUrls: result\.imageResultUrls \|\| null/);
});

test('agent chat source persists client request ids so timed-out image chats can sync completed results', () => {
  assert.match(source, /const clientRequestId = String\(payload\?\.clientRequestId \|\| createEntityId\(\)\)\.trim\(\) \|\| createEntityId\(\);/);
  assert.match(source, /const clientRequestId = String\(body\?\.clientRequestId \|\| createEntityId\(\)\)\.trim\(\) \|\| createEntityId\(\);/);
  assert.match(source, /clientRequestId,/);
  assert.match(source, /metadata: \{ selectedModel, reasoningLevel: payload\?\.reasoningLevel \|\| null, webSearchEnabled: Boolean\(payload\?\.webSearchEnabled\), requestMode, clientRequestId \}/);
  assert.match(source, /metadata: \{ selectedModel: result\.selectedModel, usedRetrieval: result\.usedRetrieval, requestMode, clientRequestId, imagePlan: result\.imagePlan \|\| null, imageResultUrls: result\.imageResultUrls \|\| null, retrievalSummary: result\.retrievalSummary \|\| \[\] \}/);
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
  assert.match(source, /const usedImageReferences = preferredInputImageUrls\.map\(\(url\) => normalizedRefs\.find\(\(item\) => item\.url === url\)\)\.filter\(Boolean\);/);
  assert.match(source, /输入图顺序说明（必须严格按下列顺序理解）/);
  assert.match(source, /图\$\{index \+ 1\}：URL=\$\{url\}/);
  assert.match(source, /const promptReferenceText = buildImagePromptReferenceText\(normalizedRefs, preferredInputImageUrls\);/);
  assert.match(source, /const finalPrompt = `\$\{promptPrefix\}\$\{promptReferenceText\}\\n\$\{String\(parsed\.prompt \|\| currentMessage\)\.trim\(\)\}`\.trim\(\);/);
  assert.match(source, /imageReferences: usedImageReferences,/);
  assert.match(source, /requestMode === 'image_generation' \? version\?\.modelPolicy\?\.multimodalModel : version\?\.modelPolicy\?\.defaultModel/);
});

test('agent studio source exposes draft-only training and testing endpoints in mysql and local modes', () => {
  assert.match(source, /const STUDIO_CONFIG_ASSISTANT_PROMPT = \(\{ agentName, systemPrompt, knowledgeNames, manageableKnowledgeBases, manageableKnowledgeDocuments \}\) =>/);
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
  assert.match(source, /const attachments = Array\.isArray\(body\?\.attachments\) \? body\.attachments : \[\];/);
  assert.match(source, /const selectedModel = resolveChatSessionModel\(version, body\?\.selectedModel \|\| version\.defaultChatModel \|\| version\.modelPolicy\?\.defaultModel \|\| ''\);/);
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
