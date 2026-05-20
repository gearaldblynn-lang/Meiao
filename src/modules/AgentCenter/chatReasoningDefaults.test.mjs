import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePreferredReasoningLevel, resolveSessionReasoningLevel } from './chatReasoningDefaults.mjs';

test('resolvePreferredReasoningLevel prefers medium, then low, then the first supported level', () => {
  assert.equal(resolvePreferredReasoningLevel(['minimal', 'low', 'medium', 'high']), 'medium');
  assert.equal(resolvePreferredReasoningLevel(['low', 'high']), 'low');
  assert.equal(resolvePreferredReasoningLevel(['high']), 'high');
  assert.equal(resolvePreferredReasoningLevel([]), null);
});

test('resolveSessionReasoningLevel preserves supported manual values and repairs missing or invalid values', () => {
  assert.equal(resolveSessionReasoningLevel({ reasoningLevels: ['minimal', 'low', 'medium', 'high'], requestedReasoningLevel: 'high' }), 'high');
  assert.equal(resolveSessionReasoningLevel({ reasoningLevels: ['minimal', 'low', 'medium', 'high'], requestedReasoningLevel: null }), 'medium');
  assert.equal(resolveSessionReasoningLevel({ reasoningLevels: ['low', 'high'], requestedReasoningLevel: 'medium' }), 'low');
  assert.equal(resolveSessionReasoningLevel({ reasoningLevels: [], requestedReasoningLevel: 'high' }), null);
});
