import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(new URL('./cloud-dry-run-app-state-repair.mjs', import.meta.url), 'utf8');

test('cloud app state repair dry-run refuses apply mode', () => {
  const text = source();

  assert.match(text, /process\.argv\.includes\('--apply'\)/);
  assert.match(text, /只读 dry-run/);
  assert.match(text, /FROM app_states/);
});

test('cloud app state repair dry-run has no mutating SQL', () => {
  const text = source();

  assert.doesNotMatch(text, /\bUPDATE\b/i);
  assert.doesNotMatch(text, /\bDELETE\b/i);
  assert.doesNotMatch(text, /\bINSERT\b/i);
  assert.doesNotMatch(text, /\bALTER\b/i);
  assert.doesNotMatch(text, /\bDROP\b/i);
  assert.doesNotMatch(text, /\bTRUNCATE\b/i);
  assert.doesNotMatch(text, /\bCREATE\b/i);
});
