import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const testingPaneSource = readFileSync(new URL('./AgentStudioTestingPane.tsx', import.meta.url), 'utf8');
const trainingPaneSource = readFileSync(new URL('./AgentStudioTrainingPane.tsx', import.meta.url), 'utf8');

test('main chat and studio testing reset reasoning to the model default when switching models', () => {
  assert.match(moduleSource, /const nextReasoningLevel = resolveReasoningLevelForModel\(value, null\);/);
  assert.match(testingPaneSource, /const nextReasoningLevel = resolveReasoningLevelForModel\(value, null\);/);
});

test('studio training resets reasoning to the model default when switching models', () => {
  assert.match(trainingPaneSource, /setReasoningLevel\(\(\) => resolveReasoningLevelForModel\(value, null\)\);/);
});
