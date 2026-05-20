import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('stream asset uploads use a video-sized multipart limit instead of the JSON body limit', () => {
  assert.match(source, /const MAX_JSON_BODY_BYTES = 25 \* 1024 \* 1024/);
  assert.match(source, /const MAX_STATE_BODY_BYTES = 100 \* 1024 \* 1024/);
  assert.match(source, /const MAX_MULTIPART_BODY_BYTES = 1024 \* 1024 \* 1024/);

  const multipartReader = source.match(/const readMultipartFormData = async \(req\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(multipartReader, /MAX_MULTIPART_BODY_BYTES/);
  assert.doesNotMatch(multipartReader, /contentLength > MAX_JSON_BODY_BYTES/);
});

test('app state saves use a dedicated compatibility limit for old large snapshots', () => {
  const stateSaveHandlers = Array.from(
    source.matchAll(/url\.pathname === '\/api\/state' && req\.method === 'PUT'[\s\S]*?readBody\(req, \{ maxBytes: MAX_STATE_BODY_BYTES \}\)/g),
  );
  const loginHandler = source.match(/url\.pathname === '\/api\/auth\/login' && req\.method === 'POST'[\s\S]*?return;\n  \}/)?.[0] || '';

  assert.equal(stateSaveHandlers.length, 2);
  assert.doesNotMatch(loginHandler, /MAX_STATE_BODY_BYTES/);
});

test('kie fallback asset upload keeps the original file extension for video mime detection', () => {
  assert.match(source, /const sanitizeUploadFileName = \(value\) => \{/);
  assert.match(source, /path\.extname\(raw\)\.slice\(0, 16\)/);
  assert.match(source, /return `\$\{safeBase\}\$\{safeExt\}`/);
  assert.match(source, /sanitizeUploadFileName\(originalFileName\)/);
  assert.match(source, /sanitizeUploadFileName\(file\.name \|\| 'upload\.bin'\)/);
  assert.doesNotMatch(source, /sanitizePathPart\(file\.name \|\| 'upload\.bin'\)/);
});
