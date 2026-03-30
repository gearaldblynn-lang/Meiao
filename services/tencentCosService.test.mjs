import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('uploadToCos only prepares base64 fallback after stream upload fails', () => {
  const source = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');
  const streamUploadIndex = source.indexOf('result = await uploadInternalAssetStream');
  const base64Index = source.indexOf('const base64Data = await fileToBase64(uploadFile);');

  assert.notEqual(streamUploadIndex, -1);
  assert.notEqual(base64Index, -1);
  assert.ok(
    base64Index > streamUploadIndex,
    'base64 fallback should be prepared only after stream upload attempt'
  );
});

test('uploadToCos compresses oversized images before upload', () => {
  const source = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /preparedFile = await prepareImageForUpload\(file\);/,
    'uploadToCos should prepare oversized images before upload'
  );
  assert.match(
    source,
    /file: preparedFile/,
    'stream upload should use the prepared file'
  );
  assert.match(
    source,
    /fileToBase64\(uploadFile\)/,
    'base64 fallback should use the prepared file'
  );
});

test('uploadToCos surfaces file-specific compression errors', () => {
  const source = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /throw new Error\(`文件「\$\{file\.name\}」上传前压缩失败：\$\{compressionError\.message\}`\);/,
    'compression failures should include the offending file name in the thrown message'
  );
});
