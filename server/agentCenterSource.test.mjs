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
  assert.match(source, /supportsImageInput/);
  assert.match(source, /supportsFileInput/);
  assert.match(source, /supportsWebSearch/);
  assert.match(source, /当前模型不支持图片输入/);
  assert.match(source, /当前模型不支持文件输入/);
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
  assert.match(source, /const normalizedAspectRatio = \(imageCapability\.supportedSizes \|\| \[\]\)\.includes\(requestedAspectRatio\)/);
  assert.match(source, /imageCapability\.defaultSize \|\| 'auto'/);
  assert.match(source, /requestType: result\.requestType \|\| requestMode/);
  assert.match(source, /action: requestMode === 'image_generation' \? 'create_image_task' : 'agent_chat'/);
  assert.match(source, /imagePlan: result\.imagePlan \|\| null/);
  assert.match(source, /imageResultUrls: result\.imageResultUrls \|\| null/);
});
