import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('model quality registry exposes the current MaxForAI relay model capabilities', () => {
  const qualitySource = readFileSync(new URL('./modelQuality.ts', import.meta.url), 'utf8');
  const registrySource = readFileSync(new URL('./maxforaiImageModels.mjs', import.meta.url), 'utf8');

  assert.match(qualitySource, /MODEL_OPTIONS[\s\S]*MAXFORAI_IMAGE_MODEL_IDS/);
  assert.match(qualitySource, /const maxForAiModel = getMaxForAiImageModel\(model\)/);
  assert.match(qualitySource, /if \(maxForAiModel\) return maxForAiModel\.label/);
  assert.match(qualitySource, /normalizeMaxForAiImageResolution\(requestedResolution\)/);
  assert.match(registrySource, /id: 'maxforai-image-2-relay'/);
  assert.match(registrySource, /label: 'image-2中转'/);
  assert.match(registrySource, /MAXFORAI_SUPPORTED_RESOLUTIONS = Object\.freeze\(\['1K', '2K'\]\)/);
});
