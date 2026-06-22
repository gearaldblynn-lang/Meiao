import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePreferredReasoningLevel,
  resolveSessionReasoningLevel,
} from './chatSessionRules.mjs';

test('chat session reasoning defaults prefer medium, then low, then first supported level', () => {
  assert.equal(resolvePreferredReasoningLevel(['high', 'medium', 'low']), 'medium');
  assert.equal(resolvePreferredReasoningLevel(['high', 'low']), 'low');
  assert.equal(resolvePreferredReasoningLevel(['xhigh', 'high']), 'xhigh');
  assert.equal(resolvePreferredReasoningLevel([]), null);
  assert.equal(resolvePreferredReasoningLevel('high'), null);
});

test('chat session reasoning level respects capability support and valid user requests', () => {
  assert.equal(resolveSessionReasoningLevel({
    capability: { supportsReasoningLevel: false, reasoningLevels: ['medium'] },
    requestedReasoningLevel: 'medium',
  }), null);
  assert.equal(resolveSessionReasoningLevel({
    capability: { supportsReasoningLevel: true, reasoningLevels: ['low', 'medium', 'high'] },
    requestedReasoningLevel: 'high',
  }), 'high');
  assert.equal(resolveSessionReasoningLevel({
    capability: { supportsReasoningLevel: true, reasoningLevels: ['low', 'medium', 'high'] },
    requestedReasoningLevel: 'xhigh',
  }), 'medium');
  assert.equal(resolveSessionReasoningLevel({
    capability: { supportsReasoningLevel: true, reasoningLevels: ['high', 'low'] },
    requestedReasoningLevel: null,
  }), 'low');
});
