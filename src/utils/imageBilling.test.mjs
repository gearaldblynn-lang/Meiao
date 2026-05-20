import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateImageBilling,
  getImageModelCreditCost,
  normalizeBillingModel,
  normalizeBillingResolution,
} from './imageBilling.mjs';

test('image billing estimates use the configured display credit table by model and resolution', () => {
  assert.equal(getImageModelCreditCost('gpt-image-2', '1K'), 3);
  assert.equal(getImageModelCreditCost('gpt-image-2', '2k'), 5);
  assert.equal(getImageModelCreditCost('gpt-image-2', '4K'), 8);
  assert.equal(getImageModelCreditCost('nano-banana-2', '1K'), 5);
  assert.equal(getImageModelCreditCost('nano-banana-2', '2K'), 8);
  assert.equal(getImageModelCreditCost('nano-banana-2', '4K'), 12);
});

test('image billing normalizes user-facing model and resolution labels', () => {
  assert.equal(normalizeBillingModel('GPT Image 2'), 'gpt-image-2');
  assert.equal(normalizeBillingModel('Nano Banana 2'), 'nano-banana-2');
  assert.equal(normalizeBillingResolution('2k 清晰度'), '2K');
  assert.equal(normalizeBillingResolution('auto'), '1K');
});

test('image billing estimates multiply per-image credits by task image count', () => {
  const estimate = estimateImageBilling({
    module: 'buyer_show',
    params: { model: 'Nano Banana 2', quality: '4K', count: '4张', setCount: '2套' },
    materialCount: 0,
  });

  assert.equal(estimate.imageCount, 8);
  assert.equal(estimate.unitCredits, 12);
  assert.equal(estimate.estimatedCredits, 96);
  assert.equal(estimate.model, 'nano-banana-2');
  assert.equal(estimate.resolution, '4K');
});

test('translation billing estimates one image per uploaded product material', () => {
  const estimate = estimateImageBilling({
    module: 'translation',
    params: { model: 'GPT Image 2', quality: '2K' },
    materialCount: 3,
  });

  assert.equal(estimate.imageCount, 3);
  assert.equal(estimate.estimatedCredits, 15);
});

test('storyboard billing estimates the direct board image request', () => {
  const estimate = estimateImageBilling({
    module: 'video',
    subFeature: 'storyboard',
    params: { model: 'GPT Image 2', quality: '1K' },
    materialCount: 2,
  });

  assert.equal(estimate.billable, true);
  assert.equal(estimate.imageCount, 1);
  assert.equal(estimate.estimatedCredits, 3);
});
