import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatConversationPane.tsx', import.meta.url), 'utf8');

test('chat conversation rendering hides provider protocol markers from old replies', () => {
  assert.match(source, /const stripConversationProtocolMarkers = \(content: string\): string =>/);
  assert.match(source, /final_answer/);
  assert.match(source, /const displayContent = stripConversationProtocolMarkers\(handoff \? stripHandoffBlock\(message\.content\) : message\.content\);/);
});
