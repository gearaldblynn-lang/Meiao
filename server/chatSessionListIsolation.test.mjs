import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterVisibleChatSessions,
  isStudioTestChatSession,
} from './chatSessionRules.mjs';

test('studio test chat sessions are hidden by title or explicit flag', () => {
  assert.equal(isStudioTestChatSession({ title: '工作室测试' }), true);
  assert.equal(isStudioTestChatSession({ title: ' 工作室测试 ' }), true);
  assert.equal(isStudioTestChatSession({ title: '普通会话', is_studio: 1 }), true);
  assert.equal(isStudioTestChatSession({ title: '普通会话', is_studio: false }), false);
});

test('normal chat session listings exclude studio test sessions and respect agent scope', () => {
  const sessions = [
    { id: 'visible-1', userId: 'user-1', agentId: 'agent-1', title: '普通会话', updatedAt: 1 },
    { id: 'studio-title', userId: 'user-1', agentId: 'agent-1', title: '工作室测试', updatedAt: 4 },
    { id: 'studio-flag', userId: 'user-1', agentId: 'agent-1', title: '普通会话', is_studio: 1, updatedAt: 3 },
    { id: 'other-agent', userId: 'user-1', agentId: 'agent-2', title: '普通会话', updatedAt: 5 },
    { id: 'other-user', userId: 'user-2', agentId: 'agent-1', title: '普通会话', updatedAt: 6 },
    { id: 'visible-2', userId: 'user-1', agentId: 'agent-1', title: '普通会话', updatedAt: 2 },
  ];

  assert.deepEqual(
    filterVisibleChatSessions(sessions, { userId: 'user-1', agentId: 'agent-1' }).map((item) => item.id),
    ['visible-2', 'visible-1']
  );
  assert.deepEqual(
    filterVisibleChatSessions(sessions, { userId: 'user-1' }).map((item) => item.id),
    ['other-agent', 'visible-2', 'visible-1']
  );
});
