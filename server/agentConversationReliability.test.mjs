import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('agent chat requests are idempotent across formal and studio sessions', () => {
  assert.match(source, /const activeDbChatReplyRequests = new Map\(\);/);
  assert.match(source, /const buildChatRequestKey = \(sessionId, clientRequestId\) =>/);
  assert.match(source, /const findDbChatExchangeByClientRequestId = async \(user, sessionId, clientRequestId\) =>/);
  assert.match(source, /const existingExchange = await findDbChatExchangeByClientRequestId\(user, sessionId, clientRequestId\);/);
  assert.match(source, /if \(activeDbChatReplyRequests\.has\(activeKey\)\) return activeDbChatReplyRequests\.get\(activeKey\);/);
  assert.match(source, /activeDbChatReplyRequests\.set\(activeKey, promise\);/);
});

test('agent chat persists the user and assistant exchange atomically after provider success', () => {
  assert.match(source, /const history = await listDbChatMessages\(user, sessionId\);/);
  assert.match(source, /const connection = await pool\.getConnection\(\);/);
  assert.match(source, /await connection\.beginTransaction\(\);/);
  assert.match(source, /await connection\.commit\(\);/);
  assert.match(source, /await connection\.rollback\(\);/);
  assert.match(source, /connection\.release\(\);/);
  assert.doesNotMatch(
    source,
    /INSERT INTO chat_messages[\s\S]{0,800}const history = await listDbChatMessages\(user, sessionId\);/,
  );
});

test('agent chat auxiliary logging and asset persistence cannot fail the main reply', () => {
  assert.match(source, /void createDbAgentUsageLog\(user, agent, version, result, 'success'\)\.catch/);
  assert.match(source, /console\.warn\('\[agent-chat\] usage log write failed'/);
  assert.match(source, /console\.warn\('\[asset-store\] runtime remote asset persistence failed'/);
  assert.match(source, /return normalizedUrl;/);
});

test('agent chat strips provider protocol markers before persisting replies', () => {
  assert.match(source, /const sanitizeAgentAssistantContent = \(content\) =>/);
  assert.match(source, /final_answer/);
  assert.match(source, /content = sanitizeAgentAssistantContent\(output\?\.result\?\.content\);/);
  assert.match(source, /content = sanitizeAgentAssistantContent\(agenticResult\.content\);/);
  assert.doesNotMatch(source, /role: 'assistant',\s*content: result\.content[\s\S]{0,600}final_answer/);
});

test('local json chat mode follows the same idempotency and history ordering safeguards', () => {
  assert.match(source, /const activeLocalChatReplyRequests = new Map\(\);/);
  assert.match(source, /const existingMessages = \(store\.chatMessages \|\| \[\]\)/);
  assert.match(source, /if \(existingUserMessage && existingAssistantMessage\) \{/);
  assert.match(source, /if \(activeLocalChatReplyRequests\.has\(activeKey\)\) \{/);
  assert.match(source, /activeLocalChatReplyRequests\.set\(activeKey, promise\);/);
  assert.doesNotMatch(
    source,
    /store\.chatMessages\.push\(userMessage\);[\s\S]{0,600}const history = \(store\.chatMessages \|\| \[\]\)/,
  );
});

test('agent sessions expose durable history signals for the conversation sidebar', () => {
  assert.match(source, /AS message_count/);
  assert.match(source, /AS image_count/);
  assert.match(source, /AS last_message_preview/);
  assert.match(source, /AS last_run_status/);
  assert.match(source, /messageCount: Number\(row\.message_count \|\| 0\)/);
  assert.match(source, /imageCount: Number\(row\.image_count \|\| 0\)/);
  assert.match(source, /lastMessagePreview: row\.last_message_preview \|\| ''/);
});

test('agent chat messages persist run identity and context trace metadata', () => {
  assert.match(source, /const runId = `run-\$\{clientRequestId\}`;/);
  assert.match(source, /const contextTrace = \{/);
  assert.match(source, /historyMessageCount: history\.length/);
  assert.match(source, /summaryUsed: Boolean\(summary\)/);
  assert.match(source, /knowledgeChunkCount:/);
  assert.match(source, /attachmentRefs:/);
  assert.match(source, /messageIds: \{ userMessageId, assistantMessageId \}/);
  assert.match(source, /status: 'completed'/);
  assert.match(source, /phase: 'completed'/);
});

test('agent image generation filters expired provider temp images before sending image URLs', () => {
  assert.match(source, /const isProviderTemporaryImageUrl = \(value\) =>/);
  assert.match(source, /filterAvailableConversationImageReferences/);
  assert.match(source, /item\?\.source !== 'current_upload' && isProviderTemporaryImageUrl\(item\?\.url\)/);
  assert.match(source, /const preferredInputImageUrls = filterAvailableAgentImageUrls/);
  assert.doesNotMatch(source, /const preferredInputImageUrls = editPreferenceHints\.preferPreviousResultAsPrimary[\s\S]{0,300}: inputImageUrls;/);
});

test('internal api timeout bridge removes abort listeners after fetch completion', () => {
  const internalApiSource = readFileSync(new URL('../src/services/internalApi.ts', import.meta.url), 'utf8');
  assert.match(internalApiSource, /const onAbort = \(\) => controller\.abort\(existingSignal\.reason\);/);
  assert.match(internalApiSource, /existingSignal\?\.addEventListener\('abort', onAbort, \{ once: true \}\);/);
  assert.match(internalApiSource, /existingSignal\?\.removeEventListener\?\.\('abort', onAbort\);/);
});
