import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseToolCallingConversation } from './agentConversationRouting.mjs';

test('配了 toolCallingProvider 走 V2', () => {
  assert.equal(shouldUseToolCallingConversation({ modelPolicy: { toolCallingProvider: 'openai_compatible' } }), true);
});

test('未配则不走 V2', () => {
  assert.equal(shouldUseToolCallingConversation({ modelPolicy: {} }), false);
  assert.equal(shouldUseToolCallingConversation({}), false);
});
