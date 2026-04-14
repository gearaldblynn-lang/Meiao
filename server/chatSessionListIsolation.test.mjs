import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('normal chat session listings exclude studio test sessions in mysql and local modes', () => {
  assert.match(source, /const isStudioTestChatSession = \(session\) =>/);
  assert.match(source, /const clauses = \['user_id = \?', '\(is_studio IS NULL OR is_studio = 0\)'\];/);
  assert.match(source, /\.filter\(\(item\) => item\.userId === user\.id && !isStudioTestChatSession\(item\) && \(!agentId \|\| item\.agentId === agentId\)\)/);
});
