import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('job output asset persistence applies image transform before storing cloud results', () => {
  const serverSource = source();

  assert.match(serverSource, /buildImageOutputTransformFromJob/);
  assert.match(serverSource, /transformImageOutputBuffer/);
  assert.match(serverSource, /const imageTransform = buildImageOutputTransformFromJob\(job\)/);
  assert.match(serverSource, /transformImageOutputBuffer\(fileBuffer, imageTransform\)/);
  assert.match(serverSource, /originalName: buildTransformedImageOutputName\(fallbackName\)/);
});
