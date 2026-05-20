import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkuGenerationAssets } from './skuGenerationUtils.mjs';

test('buildSkuGenerationAssets sends product, gift, and uploaded style reference urls for the first sku', () => {
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
  assert.deepEqual(assets.generationImageUrls, [
    'https://img.test/product-a.png',
    'https://img.test/gift-a.png',
    'https://img.test/gift-b.png',
    'https://img.test/style.png',
  ]);
});

test('buildSkuGenerationAssets sends first generated sku url as the only style reference after the first sku', () => {
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
  assert.deepEqual(assets.generationImageUrls, [
    'https://img.test/product-a.png',
    'https://img.test/gift-a.png',
    'https://img.test/sku-1-result.png',
  ]);
  assert.ok(!assets.imageUrls.includes('https://img.test/original-style.png'));
  assert.ok(!assets.generationImageUrls.includes('https://img.test/original-style.png'));
});

test('buildSkuGenerationAssets drops non-public asset urls instead of leaking local urls into generation payloads', () => {
  const assets = buildSkuGenerationAssets({
    currentImages: [
      { role: 'product', uploadedUrl: 'http://127.0.0.1:3100/api/assets/file/abc/product-a.png' },
      { role: 'gift', giftIndex: 1, uploadedUrl: '/api/assets/file/abc/gift-a.png' },
      { role: 'style_ref', uploadedUrl: 'http://localhost:3100/api/assets/file/abc/style.png' },
    ],
    firstSkuResultUrl: 'http://127.0.0.1:3100/api/assets/file/abc/sku-1.png',
    isFirst: false,
    publicBaseUrl: 'https://img.test',
  });

  assert.deepEqual(assets.productUrls, ['https://img.test/api/assets/file/abc/product-a.png']);
  assert.deepEqual(assets.giftUrls, ['https://img.test/api/assets/file/abc/gift-a.png']);
  assert.equal(assets.styleRefUrl, 'https://img.test/api/assets/file/abc/sku-1.png');
  assert.deepEqual(assets.imageUrls, [
    'https://img.test/api/assets/file/abc/product-a.png',
    'https://img.test/api/assets/file/abc/gift-a.png',
    'https://img.test/api/assets/file/abc/sku-1.png',
  ]);
});
