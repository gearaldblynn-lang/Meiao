import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertProductReplaceRegionCoverage,
  normalizeProductReplaceRegion,
} from './productReplaceRegion.mjs';

const productGroups = [
  {
    id: 'group-a',
    productNumber: 1,
    materialIds: ['a-front', 'a-side'],
    urls: ['https://assets.test/a-front.png', 'https://assets.test/a-side.png'],
    inputImageIndexes: [3, 4],
  },
  {
    id: 'group-b',
    productNumber: 2,
    materialIds: ['b-front'],
    urls: ['https://assets.test/b-front.png'],
    inputImageIndexes: [5],
  },
];

test('normalizes one manual product region without losing its stable product group identity', () => {
  assert.deepEqual(normalizeProductReplaceRegion({
    regionId: 'product-replace-region-1',
    regionIndex: 1,
    productGroupId: 'group-a',
    productNumber: 1,
    xRatio: 0.1,
    yRatio: 0.2,
    widthRatio: 0.3,
    heightRatio: 0.4,
  }), {
    version: 1,
    source: 'manual',
    regionId: 'product-replace-region-1',
    regionIndex: 1,
    productGroupId: 'group-a',
    productNumber: 1,
    xRatio: 0.1,
    yRatio: 0.2,
    widthRatio: 0.3,
    heightRatio: 0.4,
  });
});

test('requires every reference image to bind every product group exactly once', () => {
  const bindings = assertProductReplaceRegionCoverage({
    productGroups,
    regions: [
      {
        regionId: 'product-replace-region-2',
        regionIndex: 2,
        productGroupId: 'group-b',
        productNumber: 2,
        xRatio: 0.55,
        yRatio: 0.2,
        widthRatio: 0.3,
        heightRatio: 0.5,
      },
      {
        regionId: 'product-replace-region-1',
        regionIndex: 1,
        productGroupId: 'group-a',
        productNumber: 1,
        xRatio: 0.1,
        yRatio: 0.15,
        widthRatio: 0.3,
        heightRatio: 0.55,
      },
    ],
  });

  assert.deepEqual(bindings.map((binding) => ({
    productGroupId: binding.productGroupId,
    productNumber: binding.productNumber,
    targetInputImageIndexes: binding.targetInputImageIndexes,
  })), [
    { productGroupId: 'group-a', productNumber: 1, targetInputImageIndexes: [3, 4] },
    { productGroupId: 'group-b', productNumber: 2, targetInputImageIndexes: [5] },
  ]);

  assert.throws(() => assertProductReplaceRegionCoverage({
    productGroups,
    regions: [bindings[0]],
  }), /每张替换参考图都必须完成 P1 到 P2 的位置标记/);

  assert.throws(() => assertProductReplaceRegionCoverage({
    productGroups,
    regions: [bindings[0], { ...bindings[0], regionId: 'duplicate' }],
  }), /产品位置标记不能重复、遗漏或引用旧产品组/);
});
