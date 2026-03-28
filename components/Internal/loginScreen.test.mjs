import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');

test('LoginScreen no longer pre-fills default admin credentials', () => {
  assert.match(source, /useState\(''\)/);
  assert.doesNotMatch(source, /useState\('admin'\)/);
  assert.doesNotMatch(source, /useState\('Meiao123456'\)/);
});

test('LoginScreen contains official registration contact guidance', () => {
  assert.match(source, /MEIAO/);
  assert.match(source, /若需注册账号请联系：将离/);
});
