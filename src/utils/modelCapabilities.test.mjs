import test from 'node:test';
import assert from 'node:assert/strict';

import { getImageModelCapabilities } from './modelCapabilities.mjs';

test('getImageModelCapabilities reports GPT Image 2 as structured ratio and resolution capable with quality controls', () => {
  const capabilities = getImageModelCapabilities('gpt-image-2');

  assert.equal(capabilities.supportsStructuredAspectRatio, true);
  assert.equal(capabilities.supportsQualitySelection, true);
  assert.equal(capabilities.supportsStructuredResolution, true);
  assert.equal(capabilities.supportsOutputFormat, false);
  assert.equal(capabilities.maxInputImages, 16);
});

test('getImageModelCapabilities gives GPT Image 2 secondary the same image2 feature surface', () => {
  const primary = getImageModelCapabilities('gpt-image-2');
  const secondary = getImageModelCapabilities('gpt-image-2-secondary');

  assert.equal(secondary.supportsStructuredAspectRatio, primary.supportsStructuredAspectRatio);
  assert.equal(secondary.supportsStructuredResolution, primary.supportsStructuredResolution);
  assert.equal(secondary.supportsQualitySelection, primary.supportsQualitySelection);
  assert.equal(secondary.maxInputImages, primary.maxInputImages);
  assert.deepEqual(secondary.supportedAspectRatios, primary.supportedAspectRatios);
});
