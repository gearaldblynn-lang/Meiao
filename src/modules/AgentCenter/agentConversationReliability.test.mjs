import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('./AgentStudioTestingPane.tsx', import.meta.url), 'utf8');

test('formal agent conversations try to recover completed replies after uncertain failures', () => {
  assert.match(moduleSource, /const isUncertainSendFailure = \(error: any\) =>/);
  assert.match(moduleSource, /\['timeout', 'network_error', 'server_error'\]\.includes\(error\?\.code\)/);
  assert.match(moduleSource, /const shouldSyncCompletedResult = isUncertainSendFailure\(error\);/);
  assert.match(moduleSource, /await syncCompletedMessageAfterTimeout\(sendSessionId, clientRequestId\)/);
});

test('studio test conversations share the same completed-reply recovery behavior', () => {
  assert.match(studioSource, /fetchChatMessages/);
  assert.match(studioSource, /const isUncertainSendFailure = \(error: any\) =>/);
  assert.match(studioSource, /\['timeout', 'network_error', 'server_error'\]\.includes\(error\?\.code\)/);
  assert.match(studioSource, /const syncCompletedMessageAfterTimeout = async \(sessionId: string, clientRequestId: string\) =>/);
  assert.match(studioSource, /await syncCompletedMessageAfterTimeout\(session\.id, clientRequestId\)/);
  assert.match(studioSource, /await syncCompletedMessageAfterTimeout\(sessionId, clientRequestId\)/);
});

test('formal agent conversations only apply async message results to the active session', () => {
  assert.match(moduleSource, /const selectedSessionIdRef = useRef\(selectedSessionId\);/);
  assert.match(moduleSource, /const loadChatRequestSeqRef = useRef\(0\);/);
  assert.match(moduleSource, /const messageLoadSeqRef = useRef\(0\);/);
  assert.match(moduleSource, /const setActiveSessionId = \(sessionId: string\) =>/);
  assert.match(moduleSource, /const applyMessagesForSession = \(sessionId: string, nextMessages: AgentChatMessage\[\]\) =>/);
  assert.match(moduleSource, /if \(selectedSessionIdRef\.current !== sessionId\) return false;/);
  assert.match(moduleSource, /const sendSessionId = selectedSessionId;/);
  assert.match(moduleSource, /sendChatMessage\(sendSessionId,/);
  assert.match(moduleSource, /await syncCompletedMessageAfterTimeout\(sendSessionId, clientRequestId\)/);
});

test('agent chat workspace exposes durable session and context state instead of hiding history', () => {
  const workspaceSource = readFileSync(new URL('./AgentCenterChatWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspaceSource, /lastMessagePreview/);
  assert.match(workspaceSource, /imageCount/);
  assert.match(workspaceSource, /messageCount/);
  assert.match(workspaceSource, /contextTrace/);
  assert.match(workspaceSource, /任务状态/);
  assert.match(workspaceSource, /历史复用/);
});

test('agent chat runtime view is opened from a button instead of occupying a permanent column', () => {
  const workspaceSource = readFileSync(new URL('./AgentCenterChatWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspaceSource, /contextPanelOpen/);
  assert.match(workspaceSource, /setContextPanelOpen\(true\)/);
  assert.match(workspaceSource, /运行视图/);
  assert.match(workspaceSource, /fixed right-6 top-\[96px\] z-40/);
  assert.doesNotMatch(workspaceSource, /fixed inset-0 z-40 flex justify-end/);
  assert.doesNotMatch(workspaceSource, /_280px\]/);
});
