import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('server startup logs never print the admin password', () => {
  assert.doesNotMatch(source, /Default admin password/);
  assert.doesNotMatch(source, /console\.log\([^)]*MEIAO_ADMIN_PASSWORD/);
  assert.doesNotMatch(source, /console\.log\([^)]*Meiao123456/);
});
