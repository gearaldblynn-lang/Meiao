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
