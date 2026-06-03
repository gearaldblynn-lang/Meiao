import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterMaterialsForSkuUpload,
  resetSkuInputStateForProductUpload,
  shouldResetSkuInputTextForUpload,
  shouldResetSkuMaterialsForUpload,
} from './shellSkuUploadReset.mjs';

test('sku product upload starts a clean sku context and preserves only non-sku materials', () => {
  const materials = {
    product: [
      { id: 'old-sku-product', subFeature: 'sku' },
      { id: 'main-product', subFeature: 'main_image' },
    ],
    styleRef: [{ id: 'old-sku-style', subFeature: 'sku' }],
    gift: [{ id: 'old-sku-gift', subFeature: 'sku' }],
    logo: [{ id: 'brand-logo', subFeature: 'main_image' }],
  };

  assert.deepEqual(filterMaterialsForSkuUpload(materials, 'product'), {
    product: [{ id: 'main-product', subFeature: 'main_image' }],
    styleRef: [],
    gift: [],
    logo: [{ id: 'brand-logo', subFeature: 'main_image' }],
  });
});

test('sku product upload clears stale sku copy params and prompt text', () => {
  const state = {
    'one_click:sku': {
      promptText: 'old prompt',
      params: {
        mode: 'SKU',
        count: '3',
        skuCopyText_0: 'old product 1',
        skuCopyText_1: 'old product 2',
        model: 'GPT Image 2',
        ratio: '1:1',
      },
    },
  };

  assert.deepEqual(resetSkuInputStateForProductUpload(state, 'one_click:sku'), {
    'one_click:sku': {
      promptText: '',
      params: {
        mode: 'SKU',
        model: 'GPT Image 2',
        ratio: '1:1',
      },
    },
  });
});

test('sku reference uploads replace only reference materials and keep product context', () => {
  const materials = {
    product: [{ id: 'current-sku-product', subFeature: 'sku' }],
    styleRef: [
      { id: 'old-sku-style', subFeature: 'sku' },
      { id: 'main-style', subFeature: 'main_image' },
    ],
  };

  assert.deepEqual(filterMaterialsForSkuUpload(materials, 'styleRef'), {
    product: [{ id: 'current-sku-product', subFeature: 'sku' }],
    styleRef: [{ id: 'main-style', subFeature: 'main_image' }],
  });
});

test('sku upload reset is scoped to one click sku material inputs', () => {
  assert.equal(shouldResetSkuMaterialsForUpload('one_click', 'sku', 'product'), true);
  assert.equal(shouldResetSkuMaterialsForUpload('one_click', 'sku', 'styleRef'), true);
  assert.equal(shouldResetSkuMaterialsForUpload('one_click', 'main_image', 'product'), false);
  assert.equal(shouldResetSkuInputTextForUpload('one_click', 'sku', 'product'), true);
  assert.equal(shouldResetSkuInputTextForUpload('one_click', 'sku', 'styleRef'), false);
});
