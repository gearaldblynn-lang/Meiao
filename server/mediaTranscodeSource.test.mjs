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
  assert.match(source, /const multipartBodyMaxBytes = MEDIA_TRANSCODE_INPUT_MAX_BYTES \+ 2 \* 1024 \* 1024/);
  assert.match(source, /content-length[\s\S]{0,500}contentLength > multipartBodyMaxBytes/i);
  assert.match(source, /readMultipartFormData\(req, \{[\s\S]{0,120}maxBytes: multipartBodyMaxBytes/);
  assert.match(source, /file\.size > MEDIA_TRANSCODE_INPUT_MAX_BYTES/);
  assert.match(source, /readBody\(req, \{ maxBytes: 64 \* 1024 \}\)/);
});

test('media transcode upload logs the authenticated owner before reading the request body', () => {
  const handler = source.match(/const handleMediaTranscodeRequest = async[\s\S]*?\n\};/)?.[0] || '';
  const startLog = handler.indexOf("action: 'media_transcode_upload_started'");
  const bodyRead = handler.indexOf('readMultipartFormData(req');
  assert.ok(startLog >= 0);
  assert.ok(bodyRead > startLog);
  assert.match(handler, /userId:\s*user\.id/);
  assert.match(handler, /contentLength/);
});

test('media transcode result persistence shares the managed asset owner lifecycle fence', () => {
  const transcodeApi = source.match(/const mediaTranscodeApi = createMediaTranscodeApi\([\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(transcodeApi, /withManagedAssetUserLock\(userId/);
  assert.match(transcodeApi, /assertActiveDbUserUnderManagedAssetLock\(pool, userId/);
  assert.match(transcodeApi, /withLocalManagedAssetUserLock\(userId/);
  assert.match(transcodeApi, /owner\.status !== 'active'/);
});

test('health exposes only non-sensitive media transcode runtime status', () => {
  assert.match(source, /mediaTranscode:/);
  assert.match(source, /ffmpegReady/);
  assert.match(source, /ffprobeReady/);
  assert.doesNotMatch(source, /mediaTranscode:\s*\{[^}]*ffmpegPath/s);
  assert.doesNotMatch(source, /mediaTranscode:\s*\{[^}]*ffprobePath/s);
});
