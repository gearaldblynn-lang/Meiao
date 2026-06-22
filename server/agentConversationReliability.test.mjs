import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createDbChatRouteHarness,
  createLocalChatRouteHarness,
} from './agentChatRouteHarness.mjs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('local chat route returns the existing exchange for duplicate clientRequestId', async () => {
  const harness = createLocalChatRouteHarness({
    now: () => 1700000000000,
    runConversation: async () => ({ content: 'new reply', metadata: {} }),
  });

  harness.seedMessages([
    { id: 'u1', sessionId: 's1', role: 'user', clientRequestId: 'req-1', content: 'hello' },
    { id: 'a1', sessionId: 's1', role: 'assistant', clientRequestId: 'req-1', content: 'old reply', status: 'completed' },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-1',
    content: 'hello again',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.assistantMessage.content, 'old reply');
  assert.equal(harness.messages().length, 2);
});

test('local chat route rejects a new message while a run is pending in the same session', async () => {
  const harness = createLocalChatRouteHarness({
    runConversation: async () => ({ content: 'unused' }),
  });
  harness.seedMessages([
    {
      id: 'a-pending',
      sessionId: 's1',
      role: 'assistant',
      status: 'pending',
      metadata: { progressStage: 'thinking' },
    },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-2',
    content: 'next',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'agent_chat_run_active');
  assert.equal(harness.messages().length, 1);
});

test('local chat checkpoint records submitted provider task id before image result exists', async () => {
  const harness = createLocalChatRouteHarness({
    runConversation: async () => ({ content: 'unused' }),
  });
  harness.seedMessages([
    {
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      status: 'pending',
      clientRequestId: 'req-1',
      metadata: {},
    },
  ]);

  const updated = await harness.markImageTaskSubmitted({
    assistantMessageId: 'a1',
    providerTaskId: 'kie-task-1',
    imagePlan: { prompt: 'generate image' },
  });

  const message = harness.messages().find((item) => item.id === 'a1');
  assert.equal(updated, true);
  assert.equal(message.status, 'pending');
  assert.equal(message.metadata.providerTaskId, 'kie-task-1');
  assert.deepEqual(message.metadata.imagePlan, { prompt: 'generate image' });
  assert.equal(message.metadata.progressStage, 'image_task_submitted');
});

test('local chat checkpoint records completed image result attachments', async () => {
  const harness = createLocalChatRouteHarness({
    runConversation: async () => ({ content: 'unused' }),
  });
  harness.seedMessages([
    {
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      status: 'pending',
      clientRequestId: 'req-1',
      metadata: { providerTaskId: 'kie-task-1' },
    },
  ]);

  const updated = await harness.markImageResultReady({
    assistantMessageId: 'a1',
    providerTaskId: 'kie-task-1',
    imageResultUrls: ['https://cdn.test/result.png'],
  });

  const message = harness.messages().find((item) => item.id === 'a1');
  assert.equal(updated, true);
  assert.equal(message.status, 'completed');
  assert.equal(message.metadata.providerTaskId, 'kie-task-1');
  assert.deepEqual(message.metadata.imageResultUrls, ['https://cdn.test/result.png']);
  assert.equal(message.metadata.progressStage, 'image_result_ready');
  assert.deepEqual(message.attachments, [{ type: 'image', url: 'https://cdn.test/result.png' }]);
});

test('db chat route returns the existing exchange for duplicate clientRequestId', async () => {
  const harness = createDbChatRouteHarness({
    now: () => 1700000000000,
    runConversation: async () => ({ content: 'new reply', metadata: {} }),
  });

  harness.seedMessages([
    { id: 'u1', sessionId: 's1', role: 'user', clientRequestId: 'req-1', content: 'hello' },
    { id: 'a1', sessionId: 's1', role: 'assistant', clientRequestId: 'req-1', content: 'old reply', status: 'completed' },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-1',
    content: 'hello again',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.assistantMessage.content, 'old reply');
  assert.equal(harness.messages().length, 2);
});

test('db chat route rejects a new message while a run is pending in the same session', async () => {
  const harness = createDbChatRouteHarness({
    runConversation: async () => ({ content: 'unused' }),
  });
  harness.seedMessages([
    {
      id: 'a-pending',
      sessionId: 's1',
      role: 'assistant',
      status: 'pending',
      metadata: { progressStage: 'thinking' },
    },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-2',
    content: 'next',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'agent_chat_run_active');
  assert.equal(harness.messages().length, 1);
});

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

test('agent chat keeps running requests durable across refresh and blocks parallel sends', () => {
  assert.match(source, /const isAgentChatRunPendingMetadata = \(metadata\) =>/);
  assert.match(source, /const findPendingDbChatRunForSession = async \(user, sessionId, excludeClientRequestId = ''\) =>/);
  assert.match(source, /if \(activeSessionRun\) throw buildActiveAgentChatRunError\(\);/);
  assert.match(source, /buildPendingAgentChatContent\(requestMode\)/);
  assert.match(source, /status: 'pending'[\s\S]{0,260}progressStage: requestMode === 'image_generation' \? 'analyzing' : 'thinking'/);
  assert.match(source, /const markDbChatRunFailed = async \(error\) =>/);
  assert.match(source, /UPDATE chat_messages SET content = \?, attachments_json = \?, metadata_json = \?, created_at = \?/);
});

test('local json chat mode also persists pending messages before provider work', () => {
  assert.match(source, /store\.chatMessages\.push\(userMessage\);\s*store\.chatMessages\.push\(assistantMessage\);/);
  assert.match(source, /assistantMessage\.content = result\.content;/);
  assert.match(source, /assistantMessage\.content = errorMessage;/);
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

test('agent conversation uses selected model context limits instead of fixed history and output constants', () => {
  assert.match(source, /import \{ resolveContextLimits \} from '\.\/contextPlan\.mjs';/);

  const runStart = source.indexOf('const runAgentConversation = async');
  const runEnd = source.indexOf('const validateDbAgentVersion', runStart);
  assert.ok(runStart > -1, 'runAgentConversation should exist');
  assert.ok(runEnd > runStart, 'runAgentConversation slice should be bounded');
  const runSource = source.slice(runStart, runEnd);

  const selectedModelIndex = runSource.indexOf('const selectedModel = String(');
  const ctxLimitsIndex = runSource.indexOf('const ctxLimits = resolveContextLimits({');
  const promptIndex = runSource.indexOf('const messages = buildAgentPromptMessages({');
  assert.ok(selectedModelIndex > -1, 'selected model should be resolved in runAgentConversation');
  assert.ok(ctxLimitsIndex > selectedModelIndex, 'context limits should use the final selected model');
  assert.ok(promptIndex > ctxLimitsIndex, 'context limits should be resolved before prompt messages are built');

  assert.match(runSource, /modelId: selectedModel/);
  assert.match(runSource, /contextPolicy: version\.contextPolicy \|\| \{\}/);
  assert.match(runSource, /const maxRounds = ctxLimits\.maxHistoryRounds;/);
  assert.match(runSource, /const summaryThreshold = ctxLimits\.summaryTriggerThreshold;/);
  assert.match(runSource, /buildConversationSummary\(olderMessages, ctxLimits\.maxSummaryChars\)/);
  assert.match(runSource, /maxTokens: ctxLimits\.maxOutputTokens/);
  assert.doesNotMatch(runSource, /contextPolicy\.maxHistoryRounds \|\| 6/);
  assert.doesNotMatch(runSource, /contextPolicy\.summaryTriggerThreshold \|\| 10/);
  assert.doesNotMatch(runSource, /contextPolicy\.maxSummaryChars \|\| 1200/);
});

test('agent image generation filters expired provider temp images before sending image URLs', () => {
  assert.match(source, /const isProviderTemporaryImageUrl = \(value\) =>/);
  assert.match(source, /filterAvailableConversationImageReferences/);
  assert.match(source, /item\?\.source !== 'current_upload' && isProviderTemporaryImageUrl\(item\?\.url\)/);
  assert.match(source, /const preferredInputImageUrls = filterAvailableAgentImageUrls/);
  assert.doesNotMatch(source, /const preferredInputImageUrls = editPreferenceHints\.preferPreviousResultAsPrimary[\s\S]{0,300}: inputImageUrls;/);
});

test('agent creation stores selected model policies on the initial version', () => {
  const dbCreateStart = source.indexOf('const createDbAgent = async');
  const dbCreateEnd = source.indexOf('const updateDbAgent = async', dbCreateStart);
  const localCreateStart = source.indexOf('const createLocalAgent =');
  const localCreateEnd = source.indexOf('const updateLocalAgent =', localCreateStart);
  assert.ok(dbCreateStart > -1 && dbCreateEnd > dbCreateStart, 'db agent creation should be bounded');
  assert.ok(localCreateStart > -1 && localCreateEnd > localCreateStart, 'local agent creation should be bounded');

  const dbCreateSource = source.slice(dbCreateStart, dbCreateEnd);
  const localCreateSource = source.slice(localCreateStart, localCreateEnd);
  for (const createSource of [dbCreateSource, localCreateSource]) {
    assert.match(createSource, /allowedChatModels: payload\.allowedChatModels \|\| \[\]/);
    assert.match(createSource, /defaultChatModel: payload\.defaultChatModel \|\| ''/);
    assert.match(createSource, /modelPolicy: payload\.modelPolicy \|\| \{\}/);
    assert.match(createSource, /retrievalPolicy: payload\.retrievalPolicy \|\| \{\}/);
  }
});
