import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('chat session reasoning defaults prefer medium, then low, in mysql and local modes', () => {
  assert.match(source, /const resolvePreferredReasoningLevel = \(reasoningLevels = \[\]\) => \{/);
  assert.match(source, /if \(normalized\.includes\('medium'\)\) return 'medium';/);
  assert.match(source, /if \(normalized\.includes\('low'\)\) return 'low';/);
  assert.match(source, /const resolveSessionReasoningLevel = \(\{ capability = null, requestedReasoningLevel = null \} = \{\}\) => \{/);
  assert.match(source, /const defaultReasoningLevel = resolveSessionReasoningLevel\(\{ capability, requestedReasoningLevel: null \}\);/);
});
