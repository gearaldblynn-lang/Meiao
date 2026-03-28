import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('uploadToCos only prepares base64 fallback after stream upload fails', () => {
  const source = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');
  const streamUploadIndex = source.indexOf('result = await uploadInternalAssetStream');
  const base64Index = source.indexOf('const base64Data = await fileToBase64(file);');

  assert.notEqual(streamUploadIndex, -1);
  assert.notEqual(base64Index, -1);
  assert.ok(
    base64Index > streamUploadIndex,
    'base64 fallback should be prepared only after stream upload attempt'
  );
});
