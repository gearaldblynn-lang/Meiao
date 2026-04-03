import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkuGenerationAssets } from './skuGenerationUtils.mjs';

test('buildSkuGenerationAssets includes product, gift, and uploaded style reference urls for the first sku', () => {
  const assets = buildSkuGenerationAssets({
    currentImages: [
      { role: 'product', uploadedUrl: 'https://img.test/product-a.png' },
      { role: 'gift', giftIndex: 2, uploadedUrl: 'https://img.test/gift-b.png' },
      { role: 'gift', giftIndex: 1, uploadedUrl: 'https://img.test/gift-a.png' },
      { role: 'style_ref', uploadedUrl: 'https://img.test/style.png' },
    ],
    firstSkuResultUrl: null,
    isFirst: true,
  });

  assert.deepEqual(assets.productUrls, ['https://img.test/product-a.png']);
  assert.deepEqual(assets.giftUrls, ['https://img.test/gift-a.png', 'https://img.test/gift-b.png']);
  assert.equal(assets.styleRefUrl, 'https://img.test/style.png');
  assert.deepEqual(assets.imageUrls, [
    'https://img.test/product-a.png',
    'https://img.test/gift-a.png',
    'https://img.test/gift-b.png',
    'https://img.test/style.png',
  ]);
});

test('buildSkuGenerationAssets switches to first generated sku url as the only style reference after the first sku', () => {
  const assets = buildSkuGenerationAssets({
    currentImages: [
      { role: 'product', uploadedUrl: 'https://img.test/product-a.png' },
      { role: 'gift', giftIndex: 1, uploadedUrl: 'https://img.test/gift-a.png' },
      { role: 'style_ref', uploadedUrl: 'https://img.test/original-style.png' },
    ],
    firstSkuResultUrl: 'https://img.test/sku-1-result.png',
    isFirst: false,
  });

  assert.equal(assets.styleRefUrl, 'https://img.test/sku-1-result.png');
  assert.deepEqual(assets.imageUrls, [
    'https://img.test/product-a.png',
    'https://img.test/gift-a.png',
    'https://img.test/sku-1-result.png',
  ]);
  assert.ok(!assets.imageUrls.includes('https://img.test/original-style.png'));
});
