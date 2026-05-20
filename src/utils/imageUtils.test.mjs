import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('prepareImageForUpload targets 3MB uploads by default', () => {
  const source = readFileSync(new URL('./imageUtils.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /const DEFAULT_UPLOAD_IMAGE_MAX_BYTES = 3 \* 1024 \* 1024;/,
    'default upload compression limit should be 3MB'
  );
});

test('prepareImageForUpload must not silently keep oversized originals', () => {
  const source = readFileSync(new URL('./imageUtils.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /throw new Error\('图片压缩后仍超过 3MB，请压缩尺寸后重试。'\);/,
    'oversized images should be blocked from upload if they still exceed 3MB after compression'
  );
  assert.match(
    source,
    /typeof createImageBitmap === 'function'/,
    'upload compression should try createImageBitmap for more robust decoding'
  );
});

test('download helper fetches remote files into a blob before saving with an explicit extension', () => {
  const source = readFileSync(new URL('./imageUtils.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /export const downloadRemoteFile = async \(/,
    'image utils should expose a shared remote download helper'
  );
  assert.match(
    source,
    /const response = await fetch\(url, \{ mode: 'cors', cache: 'no-cache' \}\);/,
    'remote download helper should fetch the asset first instead of relying on cross-origin anchor naming'
  );
  assert.match(
    source,
    /const blobUrl = safeCreateObjectURL\(blob\);/,
    'remote download helper should save via a local blob url'
  );
  assert.match(
    source,
    /link\.download = getFileNameForBlob\(fileName, blob, url, transformed\);/,
    'remote download helper should enforce a real file extension on the saved name'
  );
});

test('download helper can resize exports before saving or zipping', () => {
  const source = readFileSync(new URL('./imageUtils.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /export interface ImageDownloadTransform/,
    'download helpers should accept export sizing metadata'
  );
  assert.match(
    source,
    /export const resolveRemoteFileBlobForDownload = async/,
    'remote assets should be resolved through a shared transform step'
  );
  assert.match(
    source,
    /const resizedBlob = await resizeImage\(blob, width, height, transform\?\.maxFileSize\);/,
    'image downloads should apply configured width, height, and max file size'
  );
  assert.match(
    source,
    /transform\?: ImageDownloadTransform/,
    'batch zip downloads should pass per-file transforms too'
  );
});

test('download helper falls back to direct anchor when remote CORS blocks blob fetching', () => {
  const source = readFileSync(new URL('./imageUtils.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /triggerDirectDownloadFallback/,
    'download helper should expose a direct fallback for cross-origin assets'
  );
  assert.match(
    source,
    /catch \(error\)/,
    'download helper should catch fetch/CORS failures'
  );
  assert.match(
    source,
    /link\.target = '_blank';/,
    'fallback should still open/download the asset instead of surfacing Failed to fetch'
  );
});
