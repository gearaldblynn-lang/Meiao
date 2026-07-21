import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./mediaTranscodeClient.ts', import.meta.url), 'utf8');

test('media transcode client uses authenticated temporary session routes', () => {
  assert.match(source, /MEIAO_INTERNAL_SESSION_TOKEN/);
  assert.match(source, /\/api\/media-transcodes\/sessions/);
  assert.match(source, /Authorization/);
  assert.match(source, /FormData/);
  assert.match(source, /formData\.append\('file'/);
  assert.match(source, /formData\.append\('kind'/);
  assert.match(source, /compatibleSource:\s*boolean/);
});

test('conversion and cancellation have abort signals and a ten-minute timeout', () => {
  assert.match(source, /600_000/);
  assert.match(source, /signal/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /startSeconds/);
  assert.match(source, /endSeconds/);
});
