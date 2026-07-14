import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./probe-media-transcode.mjs', import.meta.url), 'utf8');

test('media probe runs the production service with real local binaries and always cleans temp files', () => {
  assert.match(source, /createMediaTranscodeService/);
  assert.match(source, /validateTranscodedOutput/);
  assert.match(source, /mkdtemp/);
  assert.match(source, /finally/);
  assert.match(source, /rm\([^)]*\{\s*recursive:\s*true/);
});

test('media probe never creates jobs, spends credits, or calls external providers', () => {
  assert.doesNotMatch(source, /api\.kie\.ai/);
  assert.doesNotMatch(source, /createInternalJob/);
  assert.doesNotMatch(source, /\/api\/jobs/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /credits?/i);
});

test('media probe covers video, audio, and optional HEVC decoding', () => {
  assert.match(source, /libx264/);
  assert.match(source, /libmp3lame/);
  assert.match(source, /libx265/);
  assert.match(source, /hevc/);
});
