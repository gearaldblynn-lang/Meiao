import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendSmartFactoryConversationTurn,
  createDefaultSmartFactoryAgentState,
  normalizeSmartFactoryAgentState,
} from './smartFactoryAgentStore.mjs';

test('creates default agent state with one enabled assistant', () => {
  const state = createDefaultSmartFactoryAgentState();

  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].enabled, true);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].agentId, state.agents[0].id);
});

test('normalizes agent state and drops invalid sessions', () => {
  const state = normalizeSmartFactoryAgentState({
    agents: [{ id: 'agent-1', name: '售后助手', prompt: '回答售后问题', model: { provider: 'relay', model: 'm1' }, enabled: true }],
    sessions: [{ id: 'session-1', agentId: 'agent-1', title: '测试会话', messages: [{ role: 'user', content: '你好' }] }, { id: 'bad', agentId: 'missing' }],
  });

  assert.equal(state.agents.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].messages[0].role, 'user');
});

test('appends conversation turn with assistant answer and trace', () => {
  const state = createDefaultSmartFactoryAgentState();
  const sessionId = state.sessions[0].id;
  const next = appendSmartFactoryConversationTurn(state, {
    sessionId,
    userMessage: '退货规则是什么',
    assistantAnswer: '7 天内可退货',
    trace: [{ event: 'model_request_built' }],
  });

  assert.equal(next.sessions[0].messages.length, 2);
  assert.equal(next.sessions[0].messages[1].role, 'assistant');
  assert.deepEqual(next.sessions[0].messages[1].trace, [{ event: 'model_request_built' }]);
});
