import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helper = readFileSync(new URL('./chatModelAllowlist.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const trainingSource = readFileSync(new URL('./AgentStudioTrainingPane.tsx', import.meta.url), 'utf8');
const testingSource = readFileSync(new URL('./AgentStudioTestingPane.tsx', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('./AgentCenterManager.tsx', import.meta.url), 'utf8');

test('chat model allowlist helper expands old default allowlists to include claude', () => {
  assert.doesNotMatch(helper, /EXPANDED_LEGACY_CHAT_MODELS/);
  assert.doesNotMatch(helper, /claude-sonnet-4-6/);
  assert.match(helper, /const allowed = new Set\(\(Array\.isArray\(allowedModels\) \? allowedModels : \[\]\)\.map\(/);
});

test('agent chat, studio training, and studio testing share allowlist filtering', () => {
  assert.match(moduleSource, /filterChatModelsByAllowlist\(chatModels, selectedAgent\?\.allowedChatModels \|\| \[\]\)/);
  assert.match(trainingSource, /filterChatModelsByAllowlist\(availableChatModels, draftVersion\.allowedChatModels \|\| \[\]\)/);
  assert.match(testingSource, /filterChatModelsByAllowlist\(availableChatModels, draftVersion\.allowedChatModels \|\| \[\]\)/);
});

test('new agent defaults include gpt, gemini flash, and claude when available', () => {
  assert.match(helper, /const preferred = \['gpt-5-4-openai-resp', 'gemini-3-flash-openai'\]/);
  assert.match(managerSource, /resolveDefaultAllowedChatModels\(availableChatModels\)/);
});
