import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');

test('folder selection extracts files before clearing the input value', () => {
  assert.match(source, /const fileList = event\.target\.files;/);
  assert.match(source, /const extracted = extractFilesFromFolder\(fileList\);/);
  assert.match(source, /event\.target\.value = '';/);
  assert.doesNotMatch(source, /const fileList = event\.target\.files;\s*event\.target\.value = '';/s);
});
