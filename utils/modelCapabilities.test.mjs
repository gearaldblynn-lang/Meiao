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
