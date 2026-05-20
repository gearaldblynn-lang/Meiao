import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('./AgentStudioTestingPane.tsx', import.meta.url), 'utf8');

test('formal agent conversations try to recover completed replies after uncertain failures', () => {
  assert.match(moduleSource, /const isUncertainSendFailure = \(error: any\) =>/);
  assert.match(moduleSource, /\['timeout', 'network_error', 'server_error'\]\.includes\(error\?\.code\)/);
  assert.match(moduleSource, /const shouldSyncCompletedResult = isUncertainSendFailure\(error\);/);
  assert.match(moduleSource, /await syncCompletedMessageAfterTimeout\(selectedSessionId, clientRequestId\)/);
});

test('studio test conversations share the same completed-reply recovery behavior', () => {
  assert.match(studioSource, /fetchChatMessages/);
  assert.match(studioSource, /const isUncertainSendFailure = \(error: any\) =>/);
  assert.match(studioSource, /\['timeout', 'network_error', 'server_error'\]\.includes\(error\?\.code\)/);
  assert.match(studioSource, /const syncCompletedMessageAfterTimeout = async \(sessionId: string, clientRequestId: string\) =>/);
  assert.match(studioSource, /await syncCompletedMessageAfterTimeout\(session\.id, clientRequestId\)/);
  assert.match(studioSource, /await syncCompletedMessageAfterTimeout\(sessionId, clientRequestId\)/);
});
