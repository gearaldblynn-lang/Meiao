import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('picker fetches public models and returns a URL-free public selection', async () => {
  const source = await readFile(new URL('./VirtualModelPicker.tsx', import.meta.url), 'utf8');

  assert.match(source, /fetchVirtualModels/);
  assert.match(source, /onSelect\(\{ virtualModelId: model\.id, virtualModelVersionId: model\.currentVersionId, modelName: model\.name, modelCode: model\.code, versionNumber: model\.version\?\.versionNumber, publishedAt: model\.version\?\.publishedAt \|\| undefined \}\)/);
  assert.doesNotMatch(source, /identityProfile/);
  assert.doesNotMatch(source, /selectedAssetIds/);
  assert.doesNotMatch(source, /assets:/);
});

test('picker supports public-name and code search with tag filtering', async () => {
  const source = await readFile(new URL('./VirtualModelPicker.tsx', import.meta.url), 'utf8');

  assert.match(source, /model\.name/);
  assert.match(source, /model\.code/);
  assert.match(source, /selectedTag/);
});

test('picker prioritizes a readable portrait and high-contrast selected-model details', async () => {
  const source = await readFile(new URL('./VirtualModelPicker.tsx', import.meta.url), 'utf8');

  assert.match(source, /lg:grid-cols-3/);
  assert.match(source, /w-\[132px\] overflow-hidden rounded-md border text-left/);
  assert.match(source, /aspect-\[3\/4\]/);
  assert.match(source, /object-cover object-top/);
  assert.match(source, /已选择模特/);
  assert.match(source, /color: 'var\(--text-primary\)'/);
});
