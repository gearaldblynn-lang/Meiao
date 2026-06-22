import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(new URL('./cloud-audit-app-state-health.mjs', import.meta.url), 'utf8');

test('cloud app state health audit is guarded as read-only', () => {
  const text = source();

  assert.match(text, /process\.argv\.includes\('--apply'\)/);
  assert.match(text, /不支持 --apply/);
  assert.match(text, /FROM app_states/);
  assert.doesNotMatch(text, /\b(connection|pool)\.execute\(/);
});

test('cloud app state health audit does not contain mutating SQL statements', () => {
  const text = source();

  assert.doesNotMatch(text, /\bUPDATE\b/i);
  assert.doesNotMatch(text, /\bDELETE\b/i);
  assert.doesNotMatch(text, /\bINSERT\b/i);
  assert.doesNotMatch(text, /\bALTER\b/i);
  assert.doesNotMatch(text, /\bDROP\b/i);
  assert.doesNotMatch(text, /\bTRUNCATE\b/i);
  assert.doesNotMatch(text, /\bCREATE\b/i);
});
