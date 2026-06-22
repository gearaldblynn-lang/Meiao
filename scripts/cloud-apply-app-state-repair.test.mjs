import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(new URL('./cloud-apply-app-state-repair.mjs', import.meta.url), 'utf8');

test('cloud app state apply script requires explicit apply confirmation and a scope limiter', () => {
  const text = source();

  assert.match(text, /process\.argv\.includes\('--apply'\)/);
  assert.match(text, /APPLY_APP_STATE_REPAIR/);
  assert.match(text, /refuses apply/i);
  assert.match(text, /usernameFilter/);
  assert.match(text, /rowLimit/);
});

test('cloud app state apply script backs up every changed row before update', () => {
  const text = source();

  assert.match(text, /backups\/app-state-repair/);
  assert.match(text, /appendFile/);
  assert.match(text, /originalStateJson/);
  assert.match(text, /repairedStateJson/);
});

test('cloud app state apply script uses optimistic row update', () => {
  const text = source();

  assert.match(text, /UPDATE app_states\s+SET state_json = \?, updated_at = NOW\(\)\s+WHERE user_id = \? AND state_json = \?/i);
  assert.match(text, /affectedRows/);
});

test('cloud app state apply script does not perform unrelated mutating SQL', () => {
  const text = source();

  assert.doesNotMatch(text, /\bDELETE\b/i);
  assert.doesNotMatch(text, /\bALTER\b/i);
  assert.doesNotMatch(text, /\bDROP\b/i);
  assert.doesNotMatch(text, /\bTRUNCATE\b/i);
  assert.doesNotMatch(text, /\bCREATE\b/i);
});
