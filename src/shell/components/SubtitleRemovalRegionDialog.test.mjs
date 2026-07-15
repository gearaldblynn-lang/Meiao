import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleRemovalRegionDialog.tsx', import.meta.url), 'utf8');

test('region dialog mounts one editor and saves only the active video region', () => {
  assert.match(source, /<SubtitleRegionEditor/);
  assert.match(source, /保存区域/);
  assert.match(source, /取消/);
  assert.match(source, /onSave\(draftRegion\)/);
  assert.match(source, /fixed inset-0/);
  assert.match(source, /sm:max-w/);
});
