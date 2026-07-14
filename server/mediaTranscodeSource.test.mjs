import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('media transcode routes share one handler across mysql and local auth modes', () => {
  assert.match(source, /createMediaTranscodeSessionStore/);
  assert.match(source, /createMediaTranscodeService/);
  assert.match(source, /createMediaTranscodeApi/);
  assert.match(source, /const handleMediaTranscodeRequest = async/);
  assert.match(source, /await requireDbUser\(req, res\)[\s\S]{0,300}handleMediaTranscodeRequest/);
  assert.match(source, /localRequireUser\(req, res, store\)[\s\S]{0,300}handleMediaTranscodeRequest/);
});

test('media transcode upload has a dedicated pre-parse size limit and conversion has a small JSON limit', () => {
  assert.match(source, /MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES/);
  assert.match(source, /content-length[\s\S]{0,500}MEDIA_TRANSCODE_INPUT_MAX_BYTES/i);
  assert.match(source, /readBody\(req, \{ maxBytes: 64 \* 1024 \}\)/);
});

test('health exposes only non-sensitive media transcode runtime status', () => {
  assert.match(source, /mediaTranscode:/);
  assert.match(source, /ffmpegReady/);
  assert.match(source, /ffprobeReady/);
  assert.doesNotMatch(source, /mediaTranscode:\s*\{[^}]*ffmpegPath/s);
  assert.doesNotMatch(source, /mediaTranscode:\s*\{[^}]*ffprobePath/s);
});
