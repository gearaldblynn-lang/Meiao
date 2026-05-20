import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');

test('chat composer reasoning menu uses shared default selection instead of the first raw level', () => {
  assert.match(source, /import \{ resolveSessionReasoningLevel \} from '\.\/chatReasoningDefaults\.mjs';/);
  assert.match(source, /const effectiveReasoningLevel = selectedModelOption\?\.supportsReasoningLevel/);
  assert.match(source, /resolveSessionReasoningLevel\(\{/);
  assert.doesNotMatch(source, /\(reasoningLevel \|\| reasoningLevels\[0\] \|\| ''\) === level/);
});

test('chat composer reasoning menu opens upward to avoid clipping near the bottom composer area', () => {
  assert.match(source, /absolute left-0 bottom-11 z-20/);
});

test('chat composer toggle icons expose a high-contrast pressed state', () => {
  assert.match(source, /bg-cyan-600/);
  assert.match(source, /shadow-\[0_0_0_3px_rgba\(8,145,178,0\.18\)\]/);
  assert.match(source, /aria-pressed=\{imageModeEnabled\}/);
  assert.match(source, /aria-pressed=\{webSearchEnabled\}/);
  assert.match(source, /aria-pressed=\{Boolean\(reasoningLevel\)\}/);
});
