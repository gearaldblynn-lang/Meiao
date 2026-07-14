import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('base64 and multipart upload routes share the COS-aware uploaded asset helper', () => {
  const helperCalls = source.match(/await persistUploadedAssetIfEnabled\(\{/g) || [];
  assert.equal(helperCalls.length, 4, 'mysql/local base64 and stream handlers must share one upload path');
  assert.match(
    source,
    /const managedImage = \['source', 'reference', 'chat'\][\s\S]{0,300}resolveManagedImageUpload\([\s\S]{0,300}const isImageUpload = managedImage\.isImage[\s\S]{0,300}!isImageUpload && !isExternallyReachableBaseUrl[\s\S]{0,500}persistUploadedAssetBuffer\(/,
  );
  assert.equal((source.match(/readBody\(req, \{ maxBytes: getManagedImageJsonBodyMaxBytes\(\) \}\)/g) || []).length, 2);
  assert.equal((source.match(/readMultipartFormData\(req, \{ inspectManagedImage: true \}\)/g) || []).length, 2);
  assert.doesNotMatch(source, /readMultipartFormData\(req, \{ maxBytes: getManagedImageMultipartBodyMaxBytes\(\) \}\)/);
  assert.match(source, /for await \(const chunk of req\)[\s\S]{0,180}totalBytes > maxBytes/);
});

test('managed image failures return retryable service-unavailable instead of entering upload fallback', () => {
  assert.match(source, /managed_image_\(\?:upload_failed\|upload_disabled\)/);
  assert.match(source, /json\(res, 503,[\s\S]{0,180}retryable: true/);
});

test('generated image outputs still use the historical local persistence function', () => {
  assert.match(
    source,
    /const persistJobOutputAssetsIfEnabled[\s\S]{0,3500}persistInlineImageResult\(/,
  );
  assert.match(
    source,
    /const persistRuntimeRemoteAssetIfEnabled[\s\S]{0,1200}persistRemoteAsset\(/,
  );
});
