import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./persistedAssetClient.ts', import.meta.url), 'utf8');

test('persisted asset failure logs include actionable error detail and upload metadata', () => {
  assert.match(source, /const errorDetail = error\?\.message \|\| error\?\.code \|\| String\(error \|\| ''\);/);
  assert.match(source, /detail: errorDetail/);
  assert.match(source, /errorName: error\?\.name \|\| ''/);
  assert.match(source, /errorCode: error\?\.code \|\| ''/);
  assert.match(source, /errorStatus: error\?\.status \|\| null/);
  assert.match(source, /uploadFileName: uploadFile\.name \|\| fileName/);
  assert.match(source, /uploadMimeType: uploadFile\.type \|\| ''/);
  assert.match(source, /latencyMs: Date\.now\(\) - startedAt/);
});
